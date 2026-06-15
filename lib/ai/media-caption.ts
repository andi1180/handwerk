import type { createClient } from "@/lib/supabase/server";
import type { MediaCategory } from "@/lib/orders/queries";
import { videoFramePaths } from "@/lib/media/video-frames";
import { generateCaption, type ImageMediaType } from "./captions";

/** Privater Bucket mit den Auftrags-Medien (siehe Migration 0002). */
const STORAGE_BUCKET = "order-media";

/** Server-Client-Typ (AUTHENTICATED, RLS) — abgeleitet aus `createClient`. */
type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Minimal benötigte Felder eines Mediums für die Caption-Erzeugung. */
export type CaptionableMedia = {
  media_type: "photo" | "video";
  storage_path: string;
  keyword: string | null;
  /** Bild-Kategorie (0010) — fließt für before/after in den Prompt. */
  category: MediaCategory;
};

/** Bild-Medientyp aus der Datei-Endung ableiten (Fotos sind i. d. R. JPEG). */
function imageMediaTypeFromPath(path: string): ImageMediaType {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

/**
 * Lädt die in Phase 1 extrahierten Video-Vorschau-Frames als base64-Strings
 * (Phase 2). Die Konventions-Pfade werden vom Video-Storage-Pfad abgeleitet
 * (`videoFramePath`) und behalten dessen `{business_id}/{order_id}/`-Präfix — die
 * Storage-RLS (0002) greift unverändert über den übergebenen AUTHENTICATED Client
 * (kein `service_role`). Noch nicht extrahierte / fehlende Frames (404 ⇒ `data`
 * null) werden übersprungen; die Reihenfolge der vorhandenen Frames bleibt erhalten.
 */
async function loadVideoFrames(
  supabase: ServerClient,
  videoStoragePath: string,
): Promise<string[]> {
  const paths = videoFramePaths(videoStoragePath);
  const downloads = await Promise.all(
    paths.map((path) => supabase.storage.from(STORAGE_BUCKET).download(path)),
  );
  const frames: string[] = [];
  for (const { data: blob } of downloads) {
    if (!blob) continue; // nicht vorhanden (404) → überspringen
    frames.push(Buffer.from(await blob.arrayBuffer()).toString("base64"));
  }
  return frames;
}

/**
 * Erzeugt eine Caption für ein Medium. Bilder werden **server-seitig** über den
 * übergebenen AUTHENTICATED Client (RLS) aus dem privaten Bucket geladen und als
 * base64 an Haiku gegeben: FOTO → das Bild selbst; VIDEO → die in Phase 1
 * extrahierten Vorschau-Frames (Phase 2). Sind keine Frames vorhanden, fällt das
 * Video auf den bisherigen Stichwort-only-Pfad zurück.
 */
export async function captionForMedia(
  supabase: ServerClient,
  media: CaptionableMedia,
): Promise<string> {
  if (media.media_type !== "photo") {
    // Phase 2: die in Phase 1 extrahierten Vorschau-Frames als Vision-Input laden
    // (über RLS aus dem privaten Bucket). Keine Frames ⇒ Stichwort-only (wie bisher).
    const frames = await loadVideoFrames(supabase, media.storage_path);
    // Videos sind immer 'process' (kein Vorher/Nachher); category trotzdem durchreichen.
    return generateCaption({
      mediaType: "video",
      keyword: media.keyword,
      category: media.category,
      frames,
    });
  }

  const { data: blob } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(media.storage_path);

  // Bild nicht ladbar → mit Stichwort allein versuchen (statt hart zu scheitern).
  if (!blob) {
    return generateCaption({
      mediaType: "photo",
      keyword: media.keyword,
      category: media.category,
    });
  }

  const imageBase64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
  return generateCaption({
    mediaType: "photo",
    keyword: media.keyword,
    category: media.category,
    imageBase64,
    imageMediaType: imageMediaTypeFromPath(media.storage_path),
  });
}
