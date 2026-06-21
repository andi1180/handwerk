import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { orderBookletMedia } from "@/lib/booklet/media-order";
import { renderBusinessReel, type MediaItem } from "@/lib/reel/render";

/**
 * Schritt 2b — Betriebs-Reel-Render (0013).
 *
 * Baut aus einem Auftrag ein Betriebs-IG-Reel (9:16, 1080×1920, KEIN Audio):
 * Medien in Booklet-Reihenfolge (before → process → after), je 4 s Stills.
 * Fotos erhalten VORHER/NACHHER-Label + Logo rechts oben; Clips werden
 * normalisiert (≤6 s, stumm, Logo rechts oben).
 *
 * KEIN Intro/Outro. Schreibt in `booklets.business_reel_*` (Migration 0013).
 *
 * Guard-Reihenfolge (spezifisch für das Betriebs-Reel):
 *  1. Auth (401/403) + Order via RLS (404)
 *  2. before_after_required: ≥1 before UND ≥1 after → sonst 400
 *  3. Renderbarer Status (generated/sent/viewed/shared) → sonst 409
 *  4. ≥1 Medium gesamt → sonst 400 need_media
 *  5. Booklet vorhanden → sonst 500 no_booklet
 *
 * ISOLATION (§14.2): business_id AUS DER GELADENEN ORDER (RLS-validiert), NIE
 * aus dem Body. Alle service_role-Writes strikt auf diese business_id gescoped.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const RENDERABLE_STATUSES = ["generated", "sent", "viewed", "shared"];

type OrderRow = { id: string; business_id: string; status: string };
type BookletRow = { id: string };

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
    .select("id, business_id, status")
    .eq("id", orderId)
    .maybeSingle<OrderRow>();
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // ALLE Medien laden (RLS, sort_order ASC) für die Guard-Checks UND den Render.
  // Booklet-Reihenfolge (before → process → after) erst nach den Guards anwenden.
  const { data: mediaRows } = await supabase
    .from("order_media")
    .select("storage_path, media_type, caption, keyword, category")
    .eq("order_id", order.id)
    .order("sort_order", { ascending: true })
    .returns<MediaItem[]>();
  const allMedia = mediaRows ?? [];

  // Guard 2 (before_after_required): Betriebs-Reel macht nur Sinn mit Vorher +
  // Nachher — mindestens ein Foto je Kategorie (Fotos, nicht Videos).
  const hasBefore = allMedia.some(
    (m) => m.media_type === "photo" && m.category === "before",
  );
  const hasAfter = allMedia.some(
    (m) => m.media_type === "photo" && m.category === "after",
  );
  if (!hasBefore || !hasAfter) {
    return NextResponse.json(
      { error: "before_after_required" },
      { status: 400 },
    );
  }

  // Guard 3: renderbar ab Generierung (auch nach Versand, analog render-reel).
  if (!RENDERABLE_STATUSES.includes(order.status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 409 });
  }

  // Guard 4: ≥1 Medium gesamt.
  if (allMedia.length < 1) {
    return NextResponse.json({ error: "need_media" }, { status: 400 });
  }

  // Guard 5: Booklet muss existieren (service_role, strikt auf business_id).
  const service = createServiceClient();
  const { data: booklet, error: bookletError } = await service
    .from("booklets")
    .select("id")
    .eq("order_id", order.id)
    .eq("business_id", order.business_id)
    .maybeSingle<BookletRow>();
  if (bookletError || !booklet) {
    console.error("render-business-reel: booklet load failed", {
      order_id: order.id,
      step: "booklet_load",
      message: bookletError?.message ?? "no booklet",
    });
    return NextResponse.json({ error: "no_booklet" }, { status: 500 });
  }

  // Sofort auf 'rendering' setzen (business_reel_error löschen) + 202.
  const { error: statusError } = await service
    .from("booklets")
    .update({ business_reel_status: "rendering", business_reel_error: null })
    .eq("id", booklet.id)
    .eq("business_id", order.business_id);
  if (statusError) {
    console.error("render-business-reel: set rendering failed", {
      order_id: order.id,
      step: "set_rendering",
      message: statusError.message,
    });
    return NextResponse.json({ error: "status_failed" }, { status: 500 });
  }

  // Medien in Booklet-Reihenfolge (before → process → after).
  const media = orderBookletMedia(allMedia);

  after(() =>
    renderBusinessReel({
      orderId: order.id,
      businessId: order.business_id,
      bookletId: booklet.id,
      media,
      primaryColor: business.branding.primary_color,
      logoPath: business.branding.logo_url,
    }),
  );

  return NextResponse.json({ ok: true, status: "rendering" }, { status: 202 });
}
