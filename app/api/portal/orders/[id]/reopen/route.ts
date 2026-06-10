import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";

/**
 * POST /api/portal/orders/[id]/reopen — öffnet ein Booklet wieder zur
 * Bearbeitung: Status-Übergang `finalized` → `draft` (6c) bzw. seit 8a-1 auch
 * `generated` → `draft`. Gegenstück zu `finalize`/`generate`; bringt den
 * Editier-Modus (Capture, Reorder, Löschen, Captions) zurück. Das bereits
 * erzeugte Booklet (inkl. Token) bleibt bestehen — ein erneutes Generieren
 * behält den Token.
 *
 * Guards (alle vor dem Update):
 *  - AUTHENTICATED Server-Client (kein `service_role`); kein User ⇒ 401.
 *  - `getCurrentBusiness` (Session); kein Betrieb ⇒ 403.
 *  - Order über RLS geladen (fremde/fehlende id ⇒ 404).
 *  - Aktueller Status muss `finalized` oder `generated` sein — sonst 409. Die
 *    Versand-Stufen (`sent`/`viewed`/`shared`) lassen sich NICHT zurückdrehen.
 *
 * Das Update läuft über die `orders_all`-RLS-Policy; defensiv zusätzlich auf
 * den Ausgangsstatus gefiltert (kein Doppel-Übergang bei Races).
 */
export async function POST(
  _request: Request,
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

  // Order über RLS laden — fremde/fehlende id ⇒ 404.
  const { data: order } = await supabase
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .maybeSingle<{ id: string; status: string }>();
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Abgeschlossene oder generierte Booklets lassen sich wieder öffnen — nicht
  // mehr, sobald versendet (sent/viewed/shared).
  if (order.status !== "finalized" && order.status !== "generated") {
    return NextResponse.json({ error: "invalid_status" }, { status: 409 });
  }

  const { error } = await supabase
    .from("orders")
    .update({ status: "draft" })
    .eq("id", order.id)
    .eq("status", order.status);
  if (error) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: "draft" }, { status: 200 });
}
