import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { isAiConfigured } from "@/lib/ai/anthropic";
import { captionForMedia } from "@/lib/ai/media-caption";
import type { MediaCategory } from "@/lib/orders/queries";

/** Felder, die für die Regenerierung eines Mediums benötigt werden. */
type MediaRow = {
  id: string;
  media_type: "photo" | "video";
  storage_path: string;
  keyword: string | null;
  category: MediaCategory;
};

/**
 * POST /api/portal/orders/[id]/media/[mediaId]/caption/regenerate — generiert die
 * Caption eines **einzelnen** Mediums neu und **überschreibt** den bisherigen Wert
 * (Schritt 6b).
 *
 * ISOLATION: AUTHENTICATED Server-Client (kein `service_role`). 401/403 ohne
 * User/Betrieb. Die Medien-Zeile wird über RLS geladen und gegen `order_id`
 * (Pfad) geprüft — fremde/fehlende Kombination ⇒ 404. Das Bild wird server-seitig
 * geladen (Storage-Download → base64). Gibt `{ id, caption }` zurück.
 */
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

  if (!isAiConfigured()) {
    return NextResponse.json({ error: "ai_not_configured" }, { status: 500 });
  }

  // Medien-Zeile über RLS laden; muss zu DIESER Order gehören — sonst 404.
  const { data: media } = await supabase
    .from("order_media")
    .select("id, media_type, storage_path, keyword, category")
    .eq("id", mediaId)
    .eq("order_id", orderId)
    .maybeSingle<MediaRow>();
  if (!media) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let caption: string;
  try {
    caption = await captionForMedia(supabase, media);
  } catch {
    return NextResponse.json({ error: "generation_failed" }, { status: 502 });
  }

  // Leeres Ergebnis (Video ohne Stichwort, isMetaResponse-Fehlalarm, …):
  // KEIN DB-Update — eine bestehende Caption bleibt erhalten. Der Client zeigt
  // stattdessen einen Hinweis zum manuellen Ergänzen.
  if (caption.length === 0) {
    return NextResponse.json({ id: media.id, caption: null, empty: true }, { status: 200 });
  }

  const { error } = await supabase
    .from("order_media")
    .update({ caption })
    .eq("id", media.id)
    .eq("order_id", orderId);
  if (error) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ id: media.id, caption }, { status: 200 });
}
