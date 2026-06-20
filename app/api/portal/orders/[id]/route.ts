import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { isEmailFormat } from "@/lib/settings/options";

/** Trimmt einen String; leerer/Nicht-String-Wert → null (Feld entfernen erlaubt). */
function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * PATCH /api/portal/orders/[id] — aktualisiert die Kundenkontaktdaten
 * (`customer_email` und/oder `customer_phone`) eines Auftrags. Erlaubt das
 * Nachtragen einer fehlenden Adresse/Nummer ebenso wie das Entfernen.
 *
 * Body: `{ customer_email?: string; customer_phone?: string }` — jeweils
 * optional; nur die im Body enthaltenen Felder werden geschrieben. Pro Feld gilt:
 * leer ⇒ `null` (Entfernen erlaubt). E-Mail wird auf ihr Format geprüft (sonst
 * 400 `invalid_email`). Telefon ist Freitext — KEINE Normalisierung (passiert
 * erst beim späteren SMS-Versand).
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
  const { data: order } = await supabase
    .from("orders")
    .select("id, business_id")
    .eq("id", orderId)
    .maybeSingle<{ id: string; business_id: string }>();
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
  const updates: { customer_email?: string | null; customer_phone?: string | null } =
    {};

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

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("orders")
    .update(updates)
    .eq("id", order.id)
    .eq("business_id", order.business_id)
    .select("customer_email, customer_phone")
    .single<{ customer_email: string | null; customer_phone: string | null }>();

  if (error || !data) {
    console.error(`[order PATCH] update_failed (order ${orderId}):`, error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json(data, { status: 200 });
}
