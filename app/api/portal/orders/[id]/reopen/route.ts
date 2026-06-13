import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";

/**
 * POST /api/portal/orders/[id]/reopen — öffnet ein generiertes Booklet wieder
 * zur Bearbeitung: Status-Übergang `generated` → `draft` (UI-Label
 * „Bearbeiten"). Bringt den Editier-Modus (Capture, Reorder, Löschen, Captions)
 * zurück. Das bereits erzeugte Booklet (inkl. `access_token`/`short_code`)
 * bleibt bestehen — ein erneutes „Booklet erstellen" (generate) behält den Token
 * und damit geteilte/gedruckte Links.
 *
 * Flow-Vereinfachung: `finalized` existiert nicht mehr — der einzige reopenbare
 * Zustand ist `generated`.
 *
 * Guards (alle vor dem Update):
 *  - AUTHENTICATED Server-Client (kein `service_role`); kein User ⇒ 401.
 *  - `getCurrentBusiness` (Session); kein Betrieb ⇒ 403.
 *  - Order über RLS geladen (fremde/fehlende id ⇒ 404).
 *  - Aktueller Status muss `generated` sein — sonst 409. Die Versand-Stufen
 *    (`sent`/`viewed`/`shared`) lassen sich NICHT zurückdrehen.
 *
 * Das Update läuft über die `orders_all`-RLS-Policy; defensiv zusätzlich auf
 * `status = 'generated'` gefiltert (kein Doppel-Übergang bei Races).
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

  // Generierte Booklets lassen sich wieder öffnen — nicht mehr, sobald versendet
  // (sent/viewed/shared).
  if (order.status !== "generated") {
    return NextResponse.json({ error: "invalid_status" }, { status: 409 });
  }

  const { error } = await supabase
    .from("orders")
    .update({ status: "draft" })
    .eq("id", order.id)
    .eq("status", "generated");
  if (error) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: "draft" }, { status: 200 });
}
