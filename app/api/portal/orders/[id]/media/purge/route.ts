import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { purgeOrderMedia } from "@/lib/media/purge-order-media";

/**
 * POST /api/portal/orders/[id]/media/purge — löscht die Medien eines Auftrags
 * (Storage-Dateien + `order_media`-Zeilen) und setzt die Reel-Status auf
 * `'purged'`. Auftrag, Booklet und die komplette Analytics-Historie bleiben.
 *
 * Kein Body. Antwort = das `PurgeOrderMediaResult` (Zähler + MB + evtl. Fehler).
 *
 * ISOLATION: AUTHENTICATED Server-Client (kein `service_role`). `getCurrentBusiness`
 * (Session) → kein User/Betrieb ⇒ 401/403. Die Order wird über RLS geladen
 * (fremde/fehlende id ⇒ 404). Die `business_id` stammt **ausschließlich aus der
 * Session** und wird an `purgeOrderMedia` durchgereicht, das damit jede Query
 * zusätzlich zur RLS defensiv filtert.
 *
 * Die Lösch-Logik selbst liegt bewusst NICHT hier, sondern in
 * [lib/media/purge-order-media.ts](lib/media/purge-order-media.ts) — derselbe
 * Helfer trägt später den Aufräum-Cron (dort mit `service_role`), damit beide
 * Wege garantiert identisch löschen. Diese Route ruft ihn nur auf.
 *
 * Die statische Route `media/purge` liegt konfliktfrei neben der dynamischen
 * `media/[mediaId]` (Next.js bevorzugt das statische Segment) — dasselbe Muster
 * wie `media/reorder`.
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
    .select("id")
    .eq("id", orderId)
    .maybeSingle<{ id: string }>();
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = await purgeOrderMedia(supabase, {
    orderId: order.id,
    businessId: business.id,
  });

  if (!result.ok) {
    console.error("media purge: failed", {
      order_id: order.id,
      business_id: business.id,
      errors: result.errors,
    });
    return NextResponse.json(
      { error: "purge_failed", ...result },
      { status: 500 },
    );
  }

  return NextResponse.json(result, { status: 200 });
}
