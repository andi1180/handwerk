import type Anthropic from "@anthropic-ai/sdk";
import type { MediaCategory } from "@/lib/orders/queries";
import { getAnthropic, HAIKU_MODEL } from "./anthropic";
import { CAPTION_MAX_LENGTH } from "./caption-limits";

export { CAPTION_MAX_LENGTH } from "./caption-limits";

/** Vom Storage unterstützte Bild-Medientypen für die Vision-Eingabe. */
export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

/** Eingabe für die Caption-Generierung eines einzelnen Mediums. */
export type CaptionInput = {
  mediaType: "photo" | "video";
  keyword: string | null;
  /**
   * Bild-Kategorie (0010): before/after werden im Prompt EXPLIZIT als
   * Ausgangszustand bzw. Ergebnis qualifiziert; process wie bisher (Default).
   */
  category?: MediaCategory;
  /** base64-kodiertes Bild (nur Foto). */
  imageBase64?: string;
  imageMediaType?: ImageMediaType;
  /**
   * base64-kodierte Video-Vorschau-Frames (nur Video, Phase 2). Liegt ≥1 Frame
   * vor, gehen sie als Vision-Input (mehrere image-Blöcke) an Haiku — genau wie
   * der Foto-Pfad, nur mit mehreren Bildern statt einem. Frames sind immer JPEG.
   * Leer/undefiniert ⇒ bisheriges Verhalten (nur Stichwort).
   */
  frames?: string[];
};

/** Kategorie-Zusatz für den Caption-Prompt (0010): before/after explizit erden. */
function categoryHint(category: MediaCategory | undefined): string {
  if (category === "before") {
    return " Dies ist das VORHER-Bild (Ausgangszustand vor der Arbeit). " +
      "Formuliere die Bildunterschrift entsprechend als Ausgangslage/Vorher.";
  }
  if (category === "after") {
    return " Dies ist das NACHHER-Bild (fertiges Ergebnis nach der Arbeit). " +
      "Formuliere die Bildunterschrift entsprechend als Ergebnis/Nachher.";
  }
  return "";
}

const SYSTEM_PROMPT =
  "Du schreibst kurze Bildunterschriften für ein Handwerks-Booklet. " +
  "~12–15 Wörter, ein knappes, ansprechendes Fragment, beschreibt was im Bild passiert (Bild + Stichwort). " +
  "Deutsch, kein Marketing-Sprech, keine Anführungszeichen, keine Emojis, kein abschließender Punkt nötig. " +
  "Antworte ausschließlich mit dem Caption-Text.";

/** Anführungszeichen + abschließenden Punkt entfernen, auf das Limit kürzen. */
function cleanCaption(raw: string): string {
  let text = raw.trim();
  // Umschließende Anführungszeichen (gerade/typografisch) entfernen.
  text = text.replace(/^["“”'»«]+|["“”'»«]+$/g, "").trim();
  // Einen abschließenden Punkt entfernen (Fragment-Stil).
  text = text.replace(/\.+$/, "").trim();
  // Mehrfach-Whitespace/Zeilenumbrüche kollabieren.
  text = text.replace(/\s+/g, " ");
  if (text.length > CAPTION_MAX_LENGTH) {
    text = text.slice(0, CAPTION_MAX_LENGTH).trim();
  }
  return text;
}

/**
 * Meta-/Rückfrage-Präfixe (case-insensitive, am Textanfang). Eine echte Caption
 * ist ein beschreibendes Fragment in der dritten Person und beginnt nie mit einer
 * Ich-Aussage, einer Bitte oder einer Entschuldigung.
 */
const META_PREFIXES = [
  "ich ",
  "bitte",
  "leider",
  "tut mir leid",
  "es tut mir leid",
  "entschuldigung",
  "als ki",
  "als sprachmodell",
  "als assistent",
] as const;

/** Wortzahl, ab der eine Antwort als satzartig/zu lang gilt (Ziel: ~12–15 Wörter). */
const META_MAX_WORDS = 40;

/**
 * Stufe-1-Guard gegen Meta-/Rückfrage-Antworten — gilt für FOTO UND VIDEO, da er
 * zentral in `generateCaption` (dem gemeinsamen Pfad beider Medientypen) läuft.
 * Haiku liefert gelegentlich statt einer Bildunterschrift eine Rückfrage („Ich
 * benötige mehr Kontext …") oder eine Verweigerung statt eines knappen Fragments.
 * Solche Antworten werden als leer behandelt (nicht gespeichert) — die Kachel
 * bleibt „Caption fehlt" zum manuellen Nachtragen.
 *
 * Eine der folgenden Bedingungen genügt:
 *  - enthält ein Fragezeichen (Captions sind nie Fragen/Rückfragen),
 *  - beginnt mit einem Meta-/Ich-/Bitte-/Entschuldigungs-Präfix,
 *  - ist auffällig lang/satzartig statt eines knappen Fragments.
 */
export function isMetaResponse(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false; // leer ist kein Meta — wird ohnehin nicht gespeichert
  if (trimmed.includes("?")) return true;
  const lower = trimmed.toLowerCase();
  if (META_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  if (trimmed.split(/\s+/).length > META_MAX_WORDS) return true;
  return false;
}

/**
 * Erzeugt eine kurze deutsche Bildunterschrift (memorybook-Stil) für ein Medium.
 *
 * - FOTO: Bild (base64) + Stichwort gehen als Vision-Input an Haiku.
 * - VIDEO: liegen die in Phase 1 extrahierten Vorschau-Frames vor, gehen sie als
 *   Vision-Input (mehrere Bilder) + Stichwort an Haiku — genau wie der Foto-Pfad.
 *   Ohne Frames bleibt es beim Stichwort-only; ein Video ohne Frames UND ohne
 *   Stichwort liefert einen leeren String zurück (manuell nachzutragen), ohne die
 *   API zu bemühen.
 *
 * Stufe-1-Guard: Sieht die Modell-Antwort wie eine Rückfrage/Meta-Antwort statt
 * einer Caption aus (`isMetaResponse`), wird sie als leer behandelt (nicht
 * gespeichert) — greift für FOTO UND VIDEO.
 *
 * Gibt den reinen Caption-Text zurück (getrimmt, ohne Anführungszeichen/Punkt,
 * auf `CAPTION_MAX_LENGTH` begrenzt) bzw. einen leeren String, wenn nichts
 * Brauchbares entsteht.
 */
export async function generateCaption(input: CaptionInput): Promise<string> {
  // Bilder zusammenstellen: Foto = ein Bild, Video = bis zu 3 Vorschau-Frames (Phase 2).
  const images: { data: string; mediaType: ImageMediaType }[] = [];
  if (input.mediaType === "photo" && input.imageBase64) {
    images.push({
      data: input.imageBase64,
      mediaType: input.imageMediaType ?? "image/jpeg",
    });
  } else if (input.mediaType === "video" && input.frames) {
    for (const frame of input.frames) {
      // Extrahierte Frames sind per Konvention immer JPEG (siehe video-frames.ts).
      images.push({ data: frame, mediaType: "image/jpeg" });
    }
  }

  // Video ohne Frames UND ohne Stichwort → nichts, woraus eine Caption entstehen kann.
  if (input.mediaType === "video" && images.length === 0 && !input.keyword) {
    return "";
  }

  const content: Anthropic.ContentBlockParam[] = [];
  for (const image of images) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType,
        data: image.data,
      },
    });
  }

  const keywordLine = input.keyword
    ? `Stichwort: ${input.keyword}`
    : "Kein Stichwort angegeben.";
  const subject =
    input.mediaType === "photo"
      ? "dieses Foto"
      : images.length > 0
        ? "diesen Video-Clip (gezeigt als mehrere Standbilder daraus)"
        : "diesen Video-Clip";
  content.push({
    type: "text",
    text: `Schreibe eine kurze Bildunterschrift für ${subject}. ${keywordLine}${categoryHint(input.category)}`,
  });

  const anthropic = getAnthropic();
  // Haiku 4.5 unterstützt KEIN effort/adaptives Thinking — schlichter Request.
  const message = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 128,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  const raw = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join(" ")
    .trim();

  // Stufe-1-Guard (Foto UND Video): Meta/Rückfrage statt Caption → verwerfen.
  // Auf dem ROH-Text prüfen, bevor cleanCaption auf CAPTION_MAX_LENGTH kürzt.
  if (isMetaResponse(raw)) return "";

  return cleanCaption(raw);
}
