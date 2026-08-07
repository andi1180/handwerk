import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { compressOrderVideo } from "@/lib/media/compress-video";

/**
 * POST /api/portal/orders/[id]/media/[mediaId]/compress — stößt die
 * **serverseitige Kompression** eines bereits hochgeladenen Videos an
 * (720p / H.264 CRF 23 / AAC 128k). Kein Body.
 *
 * ASYNCHRON, FIRE-AND-FORGET: die Route validiert nur (billig) und antwortet
 * sofort mit **202**; die Transkodierung läuft in `after()` (Hintergrund nach der
 * Response, innerhalb `maxDuration`) — dasselbe Muster wie `render-reel`.
 * Es gibt bewusst KEINEN Status-Poll und KEINE Statusspalte: das Original ist
 * sofort verfügbar und voll nutzbar, und Booklets werden erst Tage später
 * versendet — der Hintergrundjob hat also reichlich Zeit. Schlägt er fehl, bleibt
 * das Original unangetastet (nur größer) und ein späterer gezielter Nachlauf
 * kann dieselbe Funktion erneut aufrufen.
 *
 * ISOLATION (§14.2):
 *  - AUTHENTICATED Server-Client für die Validierung; kein User ⇒ 401, kein
 *    Betrieb ⇒ 403.
 *  - Order über RLS geladen (fremde/fehlende id ⇒ 404); die `business_id` stammt
 *    AUSSCHLIESSLICH aus dieser Order, NIEMALS aus dem Request.
 *  - Medien-Zeile über RLS gegen die Order geprüft ⇒ sonst 404; kein Video ⇒ 400.
 *  - Die Hintergrundarbeit läuft mit `service_role` (request-unabhängig, da die
 *    Cookie-Session nach der Response nicht mehr trägt) — strikt auf die zuvor
 *    validierten `order_id`/`business_id`/`media_id` gescoped, die
 *    `compressOrderVideo` zusätzlich als Filter auf jede Query legt.
 *
 * Die Transkodier-Logik liegt bewusst NICHT hier, sondern in
 * [lib/media/compress-video.ts](lib/media/compress-video.ts) — derselbe Helfer
 * trägt später den gezielten Nachlauf für bestehende Aufträge.
 *
 * Node-Runtime erzwingen (Edge kann kein child_process / Binary ausführen) und
 * maxDuration anheben (Fluid Compute) — Download + ffmpeg + Upload dürfen dauern.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

type MediaRow = { id: string; media_type: string };

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; mediaId: string }> },
) {
  const { id: orderId, mediaId } = await params;

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

  // Medien-Zeile über RLS laden; muss zu DIESER Order gehören — sonst 404.
  const { data: media } = await supabase
    .from("order_media")
    .select("id, media_type")
    .eq("id", mediaId)
    .eq("order_id", order.id)
    .maybeSingle<MediaRow>();
  if (!media) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (media.media_type !== "video") {
    return NextResponse.json({ error: "not_a_video" }, { status: 400 });
  }

  const businessId = order.business_id;

  after(async () => {
    const result = await compressOrderVideo(createServiceClient(), {
      orderId: order.id,
      businessId,
      mediaId: media.id,
    });
    if (!result.ok) {
      console.error("compress-video: failed", {
        order_id: order.id,
        business_id: businessId,
        media_id: media.id,
        errors: result.errors,
      });
    } else if (result.skipped) {
      console.log("compress-video: skipped", {
        order_id: order.id,
        media_id: media.id,
        reason: result.reason,
        original_bytes: result.originalBytes,
        compressed_bytes: result.compressedBytes,
      });
    } else {
      console.log("compress-video: ok", {
        order_id: order.id,
        media_id: media.id,
        original_bytes: result.originalBytes,
        compressed_bytes: result.compressedBytes,
        mb_saved: result.megabytesSaved,
      });
    }
  });

  return NextResponse.json({ ok: true, status: "compressing" }, { status: 202 });
}
