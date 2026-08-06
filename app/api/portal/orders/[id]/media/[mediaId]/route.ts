import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { videoFramePaths } from "@/lib/media/video-frames";

/**
 * DELETE /api/portal/orders/[id]/media/[mediaId] — entfernt ein Medium eines
 * Auftrags (mobiler Assembler 6a): Storage-Objekt **und** `order_media`-Zeile.
 *
 * ISOLATION: AUTHENTICATED Server-Client (kein `service_role`). `getCurrentBusiness`
 * (Session) → kein User/Betrieb ⇒ 401/403. Die Medien-Zeile wird über RLS geladen
 * und zusätzlich gegen `order_id` (Pfad) geprüft — fremde/fehlende Kombination
 * ⇒ 404. Das Storage-Objekt wird über die Delete-Policy entfernt (erstes
 * Pfad-Segment = `business_id`); danach wird die Zeile per RLS gelöscht.
 * Reihenfolge-Lücken im `sort_order` sind unkritisch (Sortierung bleibt ASC).
 *
 * VIDEO-FRAMES: die client-seitig extrahierten Vorschaubilder eines Videos
 * (`{video-pfad-ohne-endung}.frame-0/1/2.jpg`, s. `lib/media/video-frames.ts`)
 * haben **keine** eigene `order_media`-Zeile — ihre Existenz hängt allein am
 * Konventions-Pfad. Sie werden hier im selben `remove()`-Aufruf mitgelöscht;
 * vorher blieben sie als Storage-Leichen zurück. Sie liegen unter demselben
 * `{business_id}/{order_id}/`-Präfix wie das Video, die 0002-Delete-Policy
 * greift also unverändert.
 */
export async function DELETE(
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

  // Medien-Zeile über RLS laden; muss zu DIESER Order gehören — sonst 404.
  const { data: media } = await supabase
    .from("order_media")
    .select("id, media_type, storage_path")
    .eq("id", mediaId)
    .eq("order_id", orderId)
    .maybeSingle<{ id: string; media_type: string; storage_path: string }>();
  if (!media) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Bei Video zusätzlich die Konventions-Frames; bei Foto bleibt es beim Hauptpfad.
  const framePaths =
    media.media_type === "video" ? videoFramePaths(media.storage_path) : [];

  // Storage-Objekte entfernen (Delete-Policy bindet erstes Pfad-Segment an business_id).
  const { error: storageError } = await supabase.storage
    .from("order-media")
    .remove([media.storage_path, ...framePaths]);

  if (storageError) {
    // Frames sind best-effort: nicht jedes Video hat (alle) Frames, und ein
    // Problem an einem Vorschaubild darf das Löschen des Videos nicht
    // blockieren. Darum ein zweiter Versuch NUR mit dem Hauptpfad — erst wenn
    // auch der scheitert, ist es ein echter Fehler.
    if (framePaths.length === 0) {
      return NextResponse.json({ error: "storage_delete_failed" }, { status: 500 });
    }
    const { error: retryError } = await supabase.storage
      .from("order-media")
      .remove([media.storage_path]);
    if (retryError) {
      return NextResponse.json({ error: "storage_delete_failed" }, { status: 500 });
    }
    console.error("media delete: frame cleanup failed", {
      order_id: orderId,
      media_id: media.id,
      step: "remove_frames",
      message: storageError.message,
    });
  }

  // Metadaten-Zeile löschen (RLS-Policy order_media_all), defensiv auf order_id.
  const { error: rowError } = await supabase
    .from("order_media")
    .delete()
    .eq("id", media.id)
    .eq("order_id", orderId);
  if (rowError) {
    return NextResponse.json({ error: "row_delete_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
