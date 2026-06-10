import type { createClient } from "@/lib/supabase/server";
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
 * Erzeugt eine Caption für ein Medium. Das Bild wird **server-seitig** über den
 * übergebenen AUTHENTICATED Client (RLS) aus dem privaten Bucket geladen und als
 * base64 an Haiku gegeben (Foto). Video → nur Stichwort (Frame-Extraktion folgt
 * später mit dem Reel).
 */
export async function captionForMedia(
  supabase: ServerClient,
  media: CaptionableMedia,
): Promise<string> {
  if (media.media_type !== "photo") {
    return generateCaption({ mediaType: "video", keyword: media.keyword });
  }

  const { data: blob } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(media.storage_path);

  // Bild nicht ladbar → mit Stichwort allein versuchen (statt hart zu scheitern).
  if (!blob) {
    return generateCaption({ mediaType: "photo", keyword: media.keyword });
  }

  const imageBase64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
  return generateCaption({
    mediaType: "photo",
    keyword: media.keyword,
    imageBase64,
    imageMediaType: imageMediaTypeFromPath(media.storage_path),
  });
}
