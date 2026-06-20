import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { ARCHIVABLE_STATUSES } from "@/lib/orders/archive";

/** Sane Obergrenze für eine Bulk-Archivierung pro Request. */
const MAX_BULK_IDS = 500;

/**
 * GET /api/portal/orders/archive-bulk?scope=all-done — zählt die archivierbaren
 * AKTIVEN Aufträge des Betriebs (für die Bestätigung von „Alle erledigten
 * archivieren", 3b-2a).
 *
 * ISOLATION wie POST: AUTHENTICATED Client, 401/403 ohne User/Betrieb,
 * `business_id` NUR aus der Session. Dieselbe Eligibility-`.or(...)`-Bedingung
 * wie der UPDATE-Pfad (geteilte `ARCHIVABLE_STATUSES`, kein Drift). Reiner
 * `count`-`head`-Read. Rückgabe `{ count }`.
 */
export async function GET(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const business = await getCurrentBusiness();
  if (!business) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const scope = new URL(request.url).searchParams.get("scope");
  if (scope !== "all-done") {
    return NextResponse.json({ error: "invalid_scope" }, { status: 400 });
  }

  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("business_id", business.id)
    .is("archived_at", null)
    .or(
      `status.in.(${ARCHIVABLE_STATUSES.join(",")}),picked_up_at.not.is.null`,
    );

  if (error) {
    console.error("[orders archive-bulk] count_failed:", error);
    return NextResponse.json({ error: "count_failed" }, { status: 500 });
  }

  return NextResponse.json({ count: count ?? 0 });
}

/**
 * POST /api/portal/orders/archive-bulk — archiviert mehrere Aufträge in EINEM UPDATE.
 *
 * Body (zwei Formen, `archive` muss in beiden strikt `true` sein):
 *  - `{ ids: string[], archive: true }`      — die gewählten IDs (3a).
 *  - `{ scope: "all-done", archive: true }`  — ALLE archivierbaren aktiven
 *                                              Aufträge des Betriebs (3b-2a),
 *                                              ohne IDs, ohne Cap.
 * Nur Archivieren — kein Bulk-Unarchive.
 *
 * ISOLATION: AUTHENTICATED Server-Client (kein `service_role`). 401/403 ohne
 * User/Betrieb. Das UPDATE läuft über die RLS-/Update-Policy des authentifizierten
 * Clients (skopiert auf den Betrieb); zusätzlich defensiv auf `business_id` gefiltert.
 * `business_id` kommt NIE aus dem Body.
 *
 * Eligibility steckt im WHERE (spiegelt `isArchivable` über die geteilte
 * `ARCHIVABLE_STATUSES`-Liste): nur Aufträge mit `archived_at IS NULL` UND
 * (status ∈ {sent,viewed,shared} ODER picked_up_at IS NOT NULL). Nicht-archivierbare
 * oder fremde IDs werden durch das WHERE still übersprungen (kein Fehler) — kein
 * Per-Row-Loop. Rückgabe `{ archived: <Anzahl tatsächlich archivierter Aufträge> }`.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const business = await getCurrentBusiness();
  if (!business) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const payload = (body ?? {}) as Record<string, unknown>;

  if (payload.archive !== true) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // 3b-2a: „Alle erledigten archivieren" — EIN direktes UPDATE über ALLE
  // archivierbaren aktiven Aufträge des Betriebs (keine IDs, kein Cap). Dieselbe
  // Eligibility-`.or(...)`-Bedingung wie der IDs-Pfad (geteilte
  // ARCHIVABLE_STATUSES, kein Drift); `business_id` NUR aus der Session.
  if (payload.scope === "all-done") {
    const { data, error } = await supabase
      .from("orders")
      .update({ archived_at: new Date().toISOString() })
      .eq("business_id", business.id)
      .is("archived_at", null)
      .or(
        `status.in.(${ARCHIVABLE_STATUSES.join(",")}),picked_up_at.not.is.null`,
      )
      .select("id")
      .returns<{ id: string }[]>();

    if (error) {
      console.error("[orders archive-bulk] all_done_failed:", error);
      return NextResponse.json({ error: "update_failed" }, { status: 500 });
    }

    return NextResponse.json({ archived: data?.length ?? 0 });
  }

  // Bestehender IDs-Pfad (unverändert): `{ ids: string[], archive: true }`.
  if (!Array.isArray(payload.ids)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  // Nur eindeutige, nicht-leere String-IDs.
  const ids = [
    ...new Set(
      payload.ids.filter(
        (v): v is string => typeof v === "string" && v.length > 0,
      ),
    ),
  ];
  if (ids.length === 0 || ids.length > MAX_BULK_IDS) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // EIN UPDATE. Eligibility + Betrieb + „noch nicht archiviert" stehen im WHERE.
  // `.or(...)` bildet die OR-Bedingung von `isArchivable` ab; `.select("id")`
  // liefert die tatsächlich getroffenen Zeilen ⇒ exakter archived-Count.
  const { data, error } = await supabase
    .from("orders")
    .update({ archived_at: new Date().toISOString() })
    .in("id", ids)
    .eq("business_id", business.id)
    .is("archived_at", null)
    .or(
      `status.in.(${ARCHIVABLE_STATUSES.join(",")}),picked_up_at.not.is.null`,
    )
    .select("id")
    .returns<{ id: string }[]>();

  if (error) {
    console.error("[orders archive-bulk] update_failed:", error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ archived: data?.length ?? 0 });
}
