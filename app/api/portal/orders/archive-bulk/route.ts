import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { ARCHIVABLE_STATUSES } from "@/lib/orders/archive";
import { isQuickFilter, isStatusFilter } from "@/lib/orders/filters";
import {
  buildFilteredOrdersQuery,
  getDraftWithMediaIds,
} from "@/lib/orders/orders-query";
import type { QuickFilter, StatusFilter } from "@/lib/orders/filters";

/** Sane Obergrenze für eine Bulk-Archivierung (IDs-Pfad) pro Request. */
const MAX_BULK_IDS = 500;

/**
 * Obergrenze für den by-filter-Bulk (`scope:"filter"`): so viele Filter-Treffer
 * löst die select-then-update-Query maximal auf. Bewusst großzügig — realistische
 * Einzelbetriebs-Mengen liegen weit darunter. Die Operation ist idempotent: bei
 * mehr Treffern archiviert ein erneuter Klick den Rest; `{ archived }` bleibt
 * immer die TATSÄCHLICH archivierte Anzahl (kein „false amount").
 */
const MAX_FILTER_RESOLVE = 5000;

type ResolvedFilter = {
  status: StatusFilter | null;
  quick: QuickFilter | null;
  q: string | null;
};

/**
 * Validiert + löst die Filter-Achsen auf — MIRROR der Listen-Logik (`page.tsx`):
 * Quick (`?quick=`) hat Vorrang vor Status (`?status=`); ist ein Quick aktiv,
 * wird der Status verworfen. `null`/`undefined` = Achse nicht gesetzt. Ein
 * VORHANDENER, aber ungültiger Status/Quick-Wert ⇒ `null`-Ergebnis (der Aufrufer
 * antwortet 400), damit der by-filter-Bulk nur exakt rekonstruierbare Filter
 * archiviert (kein „raten").
 *
 * `q` (Freitext-Suche, Schritt B) wird hier nur durchgereicht — die
 * Sanitisierung gegen `.or()`-Injection sitzt in `buildFilteredOrdersQuery`; ein
 * Nicht-String ⇒ `null`.
 */
function resolveFilter(
  rawStatus: unknown,
  rawQuick: unknown,
  rawQ: unknown,
): ResolvedFilter | null {
  if (rawQuick != null && !isQuickFilter(rawQuick)) return null;
  if (rawStatus != null && !isStatusFilter(rawStatus)) return null;
  const quick = isQuickFilter(rawQuick) ? rawQuick : null;
  const status = !quick && isStatusFilter(rawStatus) ? rawStatus : null;
  const q = typeof rawQ === "string" && rawQ.length > 0 ? rawQ : null;
  return { status, quick, q };
}

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

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");

  // „Alle erledigten" (3b-2a): ALLE archivierbaren aktiven Aufträge des Betriebs.
  if (scope === "all-done") {
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

  // „Alle auswählen" pro aktivem Filter (3b-2b): zählt die archivierbaren AKTIVEN
  // Aufträge GENAU des aktiven Listen-Filters (über alle Seiten). Der Count ist
  // exakt (head-only, keine Zeilen) und speist die Bestätigung.
  if (scope === "filter") {
    const filter = resolveFilter(
      url.searchParams.get("status"),
      url.searchParams.get("quick"),
      url.searchParams.get("q"),
    );
    if (!filter) {
      return NextResponse.json({ error: "invalid_filter" }, { status: 400 });
    }

    // `status='new'` braucht GENAU dieselbe „Entwurf mit Medium"-Menge wie die
    // Liste (sonst andere Treffer als angezeigt) — sonst irrelevant ⇒ leeres Set.
    const draftWithMediaIds =
      filter.status === "new"
        ? await getDraftWithMediaIds(supabase, {
            businessId: business.id,
            archived: false,
          })
        : new Set<string>();

    const { count, error } = await buildFilteredOrdersQuery(supabase, {
      businessId: business.id,
      status: filter.status,
      quick: filter.quick,
      archived: false, // by-filter-Bulk wirkt nur auf AKTIVE Aufträge (Hauptliste).
      draftWithMediaIds,
      selectCols: "id",
      count: "exact",
      head: true,
      q: filter.q ?? undefined,
    }).or(
      // Eligibility-Boden — byte-identische Bedingung wie alle Bulk-Pfade.
      `status.in.(${ARCHIVABLE_STATUSES.join(",")}),picked_up_at.not.is.null`,
    );

    if (error) {
      console.error("[orders archive-bulk] filter_count_failed:", error);
      return NextResponse.json({ error: "count_failed" }, { status: 500 });
    }

    return NextResponse.json({ count: count ?? 0 });
  }

  return NextResponse.json({ error: "invalid_scope" }, { status: 400 });
}

/**
 * POST /api/portal/orders/archive-bulk — archiviert mehrere Aufträge in EINEM UPDATE.
 *
 * Body (drei Formen, `archive` muss in allen strikt `true` sein):
 *  - `{ ids: string[], archive: true }`              — die gewählten IDs (3a).
 *  - `{ scope: "all-done", archive: true }`          — ALLE archivierbaren
 *                                                      aktiven Aufträge des
 *                                                      Betriebs (3b-2a).
 *  - `{ scope: "filter", status?, quick?, archive: true }` — ALLE archivierbaren
 *                                                      aktiven Aufträge GENAU des
 *                                                      aktiven Listen-Filters über
 *                                                      alle Seiten (3b-2b).
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

  // 3b-2b: „Alle auswählen" pro aktivem Filter — archiviert ALLE archivierbaren
  // aktiven Aufträge GENAU des aktiven Listen-Filters (über alle Seiten).
  // SELECT-THEN-UPDATE: die Embed-Filter (`in_progress` via order_media!inner,
  // creating/ready/failed via booklets!inner) lassen sich NICHT direkt als
  // UPDATE-WHERE ausdrücken ⇒ erst per `buildFilteredOrdersQuery` die IDs
  // auflösen, dann diese IDs updaten. `business_id` NUR aus der Session.
  if (payload.scope === "filter") {
    const filter = resolveFilter(payload.status, payload.quick, payload.q);
    if (!filter) {
      return NextResponse.json({ error: "invalid_filter" }, { status: 400 });
    }

    const draftWithMediaIds =
      filter.status === "new"
        ? await getDraftWithMediaIds(supabase, {
            businessId: business.id,
            archived: false,
          })
        : new Set<string>();

    // a) IDs auflösen — vollständiges Set der archivierbaren Filter-Treffer
    //    (Eligibility-Boden via `.or`, Cap MAX_FILTER_RESOLVE, ohne `.range()`).
    const { data: idRows, error: resolveError } = await buildFilteredOrdersQuery(
      supabase,
      {
        businessId: business.id,
        status: filter.status,
        quick: filter.quick,
        archived: false,
        draftWithMediaIds,
        selectCols: "id",
        q: filter.q ?? undefined,
      },
    )
      .or(
        `status.in.(${ARCHIVABLE_STATUSES.join(",")}),picked_up_at.not.is.null`,
      )
      .limit(MAX_FILTER_RESOLVE)
      .returns<{ id: string }[]>();

    if (resolveError) {
      console.error("[orders archive-bulk] filter_resolve_failed:", resolveError);
      return NextResponse.json({ error: "update_failed" }, { status: 500 });
    }

    const ids = [...new Set((idRows ?? []).map((r) => r.id))];
    if (ids.length === 0) {
      return NextResponse.json({ archived: 0 });
    }

    // b) UPDATE auf die aufgelösten IDs. Eligibility + Betrieb + „noch nicht
    //    archiviert" werden ERNEUT im WHERE angewandt (Sicherheits-Boden gegen
    //    Race/Drift zwischen Auflösen und Update); `.select("id")` ⇒ exakter Count.
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
      console.error("[orders archive-bulk] filter_update_failed:", error);
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
