import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";

/**
 * Schritt 2b — Betriebs-Reel-Status-Poll (0013).
 *
 * Gibt `{ status, url? }` zurück. `url` ist eine frisch signierte Signed-URL
 * (3600 s) auf das fertige Betriebs-Reel — **nur** wenn status === 'ready'.
 *
 * AUTHENTICATED + RLS: der AUTHENTICATED Client sieht nur Booklets des eigenen
 * Betriebs; `business_reel_url` wird über die 0002-Policy signiert (KEIN
 * service_role beim Signieren — identisch zu reel-status).
 */
export const runtime = "nodejs";

const SIGNED_URL_TTL_SECONDS = 3600;

type BookletRow = {
  business_reel_status: string;
  business_reel_url: string | null;
};

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

  // Order via RLS (fremde/fehlende id ⇒ 404).
  const { data: order } = await supabase
    .from("orders")
    .select("id, business_id")
    .eq("id", orderId)
    .maybeSingle<{ id: string; business_id: string }>();
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Booklet via RLS (business_id-gescoped, member-lesbar).
  const { data: booklet } = await supabase
    .from("booklets")
    .select("business_reel_status, business_reel_url")
    .eq("order_id", order.id)
    .eq("business_id", order.business_id)
    .maybeSingle<BookletRow>();
  if (!booklet) {
    return NextResponse.json(
      { status: "pending", url: null },
    );
  }

  // Signed-URL nur bei 'ready'.
  let url: string | null = null;
  if (booklet.business_reel_status === "ready" && booklet.business_reel_url) {
    const { data: signed } = await supabase.storage
      .from("order-media")
      .createSignedUrl(booklet.business_reel_url, SIGNED_URL_TTL_SECONDS);
    url = signed?.signedUrl ?? null;
  }

  return NextResponse.json({
    status: booklet.business_reel_status,
    url,
  });
}
