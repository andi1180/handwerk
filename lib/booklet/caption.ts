/**
 * Server-only. **Einzige** Quelle für den im Booklet sichtbaren Overlay-Text
 * eines Medien-Items — genutzt vom Web-Story-Render (Schritt 8a-2) und später
 * vom Reel-Overlay (Schritt 9), damit Story und Reel nie auseinanderdriften
 * (Schritt-8/9-Vorgabe, TECH.md).
 *
 * Regel: KI-`caption`, sonst das getippte `keyword` (Stichwort). Sind BEIDE
 * leer (z. B. Video ohne Stichwort + ohne Caption) ⇒ `null` = KEIN Overlay
 * rendern (niemals ein leeres Feld). Whitespace zählt als leer.
 */
export function displayCaption(media: {
  caption: string | null;
  keyword: string | null;
}): string | null {
  const caption = media.caption?.trim();
  if (caption) return caption;
  const keyword = media.keyword?.trim();
  if (keyword) return keyword;
  return null;
}
