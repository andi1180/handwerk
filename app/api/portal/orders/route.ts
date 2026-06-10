import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";

/** Trimmt einen String-Wert; leere/Nicht-String-Werte → null. */
function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * POST /api/portal/orders — legt einen Auftrag an.
 *
 * ISOLATION: `business_id` stammt AUSSCHLIESSLICH aus `getCurrentBusiness`
 * (Session, RLS-erzwungen), NIEMALS aus dem Request-Body. Geschrieben wird über
 * den AUTHENTICATED Server-Client (RLS-Policy `orders_all`), kein `service_role`.
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

  const customerName = trimmedOrNull(payload.customer_name);
  if (!customerName) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }

  const consentGiven = payload.consent_given === true;

  const { data, error } = await supabase
    .from("orders")
    .insert({
      business_id: business.id,
      customer_name: customerName,
      customer_email: trimmedOrNull(payload.customer_email),
      customer_phone: trimmedOrNull(payload.customer_phone),
      external_ref: trimmedOrNull(payload.external_ref),
      item_description: trimmedOrNull(payload.item_description),
      language: business.default_language,
      status: "draft",
      consent_given: consentGiven,
      consent_at: consentGiven ? new Date().toISOString() : null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
