import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { isEmailFormat } from "@/lib/settings/options";
import {
  isPositiveNumber,
  isWebsiteCategory,
  isWebsiteClothingType,
  parseNumericInput,
} from "@/lib/orders/website";

/** Trimmt einen String; leerer/Nicht-String-Wert → null (Feld entfernen erlaubt). */
function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Die fünf Website-Spalten (0015) — ein zusammengehöriger Block, siehe unten. */
const WEBSITE_KEYS = [
  "website_visible",
  "website_category",
  "website_clothing_type",
  "website_work_hours",
  "website_price",
] as const;

/**
 * PATCH /api/portal/orders/[id] — aktualisiert Kundenkontaktdaten
 * (`customer_email`/`customer_phone`) und/oder die Website-Veröffentlichung
 * (`website_*`, Migration 0015) eines Auftrags.
 *
 * Body: alle Felder optional; nur die im Body enthaltenen werden geschrieben.
 * Kontakt: leer ⇒ `null` (Entfernen erlaubt), E-Mail-Format geprüft (sonst 400
 * `invalid_email`); Telefon ist Freitext — KEINE Normalisierung (passiert erst
 * beim SMS-Versand).
 *
 * ── Website-Veröffentlichung: ein ZUSAMMENGEHÖRIGER Block ──────────────────
 * Sobald IRGENDEIN `website_*`-Key im Body steht, wird der Block als Einheit
 * bewertet — die vier Angaben sind genau dann Pflicht, wenn der Auftrag danach
 * sichtbar ist. Das gilt auch für spätere Korrekturen (z. B. Preis ändern),
 * damit ein sichtbarer Auftrag nie mit halben Angaben dasteht.
 *
 * ⚠️ EINBAHNSTRASSE: Ein bereits gespeichertes `website_visible = true` kann
 *    über diese Route NICHT auf false zurückgesetzt werden (400
 *    `website_locked`). Die VIER WERTE bleiben dabei ausdrücklich EDITIERBAR —
 *    gesperrt ist nur der Schalter selbst. Korrektur eines versehentlich
 *    veröffentlichten Auftrags ist bewusst ein SQL-Eingriff, kein Klick.
 *
 * ⚠️ REINE ERFASSUNG: kein API-Call, kein Webhook, kein Medien-Versand an eine
 *    externe Stelle. Die Werte landen ausschließlich in Handwerks eigener DB.
 *
 * ISOLATION: AUTHENTICATED Server-Client (kein `service_role`). 401/403 ohne
 * User/Betrieb. Die Order wird über RLS geladen — fremde/fehlende id ⇒ 404. Das
 * Update ist defensiv auf `id` + `business_id` gefiltert.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params;

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

  // Order über RLS laden — fremde/fehlende id ⇒ 404. business_id kommt von hier.
  // `website_visible` wird mitgeladen, weil die Sperre gegen den GESPEICHERTEN
  // Zustand prüft (nicht gegen einen Client-Wert).
  const { data: order } = await supabase
    .from("orders")
    .select("id, business_id, website_visible")
    .eq("id", orderId)
    .maybeSingle<{ id: string; business_id: string; website_visible: boolean }>();
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const payload = (body ?? {}) as Record<string, unknown>;

  // Nur die im Body enthaltenen Felder werden aktualisiert (partielles PATCH).
  const updates: {
    customer_email?: string | null;
    customer_phone?: string | null;
    website_visible?: boolean;
    website_category?: string;
    website_clothing_type?: string;
    website_work_hours?: number;
    website_price?: number;
  } = {};

  if ("customer_email" in payload) {
    const email = trimmedOrNull(payload.customer_email);
    // leer ⇒ null (entfernen); gesetzt ⇒ Format prüfen.
    if (email !== null && !isEmailFormat(email)) {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    }
    updates.customer_email = email;
  }

  if ("customer_phone" in payload) {
    // Freitext: leer ⇒ null (entfernen), sonst unverändert speichern — KEINE
    // Normalisierung (erst beim SMS-Versand).
    updates.customer_phone = trimmedOrNull(payload.customer_phone);
  }

  // ── Website-Veröffentlichung (0015) — als EINE Einheit bewertet ──────────
  // Ausgelöst, sobald irgendein website_*-Key im Body steht. So bleibt „die
  // vier Angaben sind Pflicht, solange sichtbar" auch bei reinen Korrekturen
  // (ohne mitgeschicktes website_visible) erzwungen.
  if (WEBSITE_KEYS.some((key) => key in payload)) {
    // Zielzustand: explizit im Body, sonst der gespeicherte Zustand.
    const nextVisible =
      "website_visible" in payload
        ? payload.website_visible === true
        : order.website_visible;

    // EINBAHNSTRASSE: ein gespeichertes true lässt sich hier nicht abschalten.
    // Geprüft wird der DB-Zustand, nicht der Client-Wunsch.
    if (order.website_visible && !nextVisible) {
      return NextResponse.json({ error: "website_locked" }, { status: 400 });
    }

    if (nextVisible) {
      // Sichtbar ⇒ alle vier Angaben Pflicht und gültig.
      const category = payload.website_category;
      if (!isWebsiteCategory(category)) {
        return NextResponse.json(
          { error: "invalid_website_category" },
          { status: 400 },
        );
      }

      const clothingType = payload.website_clothing_type;
      if (!isWebsiteClothingType(clothingType)) {
        return NextResponse.json(
          { error: "invalid_website_clothing_type" },
          { status: 400 },
        );
      }

      // Zahlenfelder: Komma-Dezimaltrenner erlaubt; leer/ungültig ⇒ null ⇒ 400.
      const workHours = parseNumericInput(payload.website_work_hours);
      if (!isPositiveNumber(workHours)) {
        return NextResponse.json(
          { error: "invalid_website_work_hours" },
          { status: 400 },
        );
      }

      const price = parseNumericInput(payload.website_price);
      if (!isPositiveNumber(price)) {
        return NextResponse.json(
          { error: "invalid_website_price" },
          { status: 400 },
        );
      }

      updates.website_visible = true;
      updates.website_category = category;
      updates.website_clothing_type = clothingType;
      updates.website_work_hours = workHours;
      updates.website_price = price;
    } else {
      // Nicht sichtbar (war es auch vorher nicht — sonst hätte die Sperre oben
      // gegriffen): nur das Flag schreiben. Etwaige Altwerte in den vier
      // Spalten bleiben unangetastet; sie sind unsichtbar und bedeutungslos,
      // solange website_visible = false.
      updates.website_visible = false;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("orders")
    .update(updates)
    .eq("id", order.id)
    .eq("business_id", order.business_id)
    .select(
      "customer_email, customer_phone, website_visible, website_category, website_clothing_type, website_work_hours, website_price",
    )
    .single<{
      customer_email: string | null;
      customer_phone: string | null;
      website_visible: boolean;
      website_category: string | null;
      website_clothing_type: string | null;
      website_work_hours: number | null;
      website_price: number | null;
    }>();

  if (error || !data) {
    console.error(`[order PATCH] update_failed (order ${orderId}):`, error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json(data, { status: 200 });
}
