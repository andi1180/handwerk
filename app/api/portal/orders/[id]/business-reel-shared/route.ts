import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";

/**
 * POST /api/portal/orders/[id]/business-reel-shared
 *
 * Schreibt `booklets.business_reel_shared_at = now()`, wenn das Betriebs-Reel
 * fertig ist (`business_reel_status === 'ready'`).
 *
 * Kein Body. AUTHENTICATED + RLS (kein service_role).
 * Guard-Reihenfolge: Auth → Order → Booklet → Status-Check → Update.
 * business_id ausschließlich aus der RLS-geladenen Order (§14.2).
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

  // Order via RLS — fremde/fehlende id ⇒ 404. business_id kommt von hier.
  const { data: order } = await supabase
    .from("orders")
    .select("id, business_id")
    .eq("id", orderId)
    .maybeSingle<{ id: string; business_id: string }>();
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Booklet via RLS (member-lesbar) — fehlt ⇒ 500 no_booklet.
  const { data: booklet } = await supabase
    .from("booklets")
    .select("id, business_reel_status")
    .eq("order_id", order.id)
    .eq("business_id", order.business_id)
    .maybeSingle<{ id: string; business_reel_status: string }>();
  if (!booklet) {
    return NextResponse.json({ error: "no_booklet" }, { status: 500 });
  }

  // Guard: business_reel_status muss 'ready' sein.
  if (booklet.business_reel_status !== "ready") {
    return NextResponse.json({ error: "not_ready" }, { status: 409 });
  }

  // Timestamp setzen — AUTHENTICATED-Client (RLS + member-update deckt die Spalte ab).
  const { error } = await supabase
    .from("booklets")
    .update({ business_reel_shared_at: new Date().toISOString() })
    .eq("id", booklet.id)
    .eq("business_id", order.business_id);

  if (error) {
    console.error("[business-reel-shared] update_failed", {
      order_id: orderId,
      message: error.message,
    });
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
