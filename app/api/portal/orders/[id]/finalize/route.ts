import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";

/**
 * POST /api/portal/orders/[id]/finalize — schließt den Auftrag ab (mobiler
 * Assembler 6c): Status-Übergang `draft` → `finalized`. Damit endet der
 * Editier-Modus; das Booklet ist „fertig" (Generierung folgt in Schritt 8 und
 * hängt sich an genau diesen Übergang).
 *
 * Guards (alle vor dem Update):
 *  - AUTHENTICATED Server-Client (kein `service_role`); kein User ⇒ 401.
 *  - `getCurrentBusiness` (Session); kein Betrieb ⇒ 403.
 *  - Order über RLS geladen (fremde/fehlende id ⇒ 404).
 *  - Aktueller Status muss `draft` sein — sonst 409 (nichts abzuschließen).
 *  - Mindestens ein `process`-Medium (Foto/Video) vorhanden — sonst 400
 *    `need_process` (0010): ein Auftrag mit NUR Vorher/Nachher ist nicht
 *    abschließbar; Videos sind immer `process`.
 *
 * Das Update läuft über die `orders_all`-RLS-Policy; defensiv zusätzlich auf
 * `status = 'draft'` gefiltert (kein Doppel-Übergang bei Races).
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

  // Nur ein Entwurf lässt sich abschließen.
  if (order.status !== "draft") {
    return NextResponse.json({ error: "invalid_status" }, { status: 409 });
  }

  // Mindestens ein PROZESS-Medium ist Pflicht (0010): ein Auftrag mit nur
  // before/after hat keinen Inhalt für das Booklet. Videos sind immer `process`.
  const { count } = await supabase
    .from("order_media")
    .select("id", { count: "exact", head: true })
    .eq("order_id", order.id)
    .eq("category", "process");
  if (!count || count < 1) {
    return NextResponse.json({ error: "need_process" }, { status: 400 });
  }

  const { error } = await supabase
    .from("orders")
    .update({ status: "finalized" })
    .eq("id", order.id)
    .eq("status", "draft");
  if (error) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: "finalized" }, { status: 200 });
}
