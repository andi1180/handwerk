import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";

/**
 * GET /api/portal/orders/[id]/reel-status — Status-Poll des Reel-Renders (8b-1a).
 *
 * AUTHENTICATED Server-Client; kein User ⇒ 401, kein Betrieb ⇒ 403. Order über
 * RLS geladen (fremde/fehlende id ⇒ 404). Liefert `{ status }` (booklets.reel_status)
 * und — sobald `ready` — zusätzlich eine frische Signed-URL des Reels (`reel_url`,
 * privater Bucket `order-media`, 3600 s). Liest über den AUTHENTICATED Client: die
 * 0002-Policy lässt Betriebs-Mitglieder ihren eigenen Pfad signieren — kein
 * service_role nötig.
 */
export const runtime = "nodejs";

const SIGNED_URL_TTL_SECONDS = 3600;

export async function GET(
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

  // Order über RLS (fremde/fehlende id ⇒ 404).
  const { data: order } = await supabase
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .maybeSingle<{ id: string }>();
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Booklet über RLS (member-Policy). Noch nicht generiert ⇒ kein Reel → pending.
  const { data: booklet } = await supabase
    .from("booklets")
    .select("reel_status, reel_url")
    .eq("order_id", order.id)
    .maybeSingle<{ reel_status: string | null; reel_url: string | null }>();

  const status = booklet?.reel_status ?? "pending";

  let url: string | null = null;
  if (status === "ready" && booklet?.reel_url) {
    const { data } = await supabase.storage
      .from("order-media")
      .createSignedUrl(booklet.reel_url, SIGNED_URL_TTL_SECONDS);
    url = data?.signedUrl ?? null;
  }

  return NextResponse.json({ status, url }, { status: 200 });
}
