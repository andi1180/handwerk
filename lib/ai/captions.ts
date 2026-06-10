import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, HAIKU_MODEL } from "./anthropic";
import { CAPTION_MAX_LENGTH } from "./caption-limits";

export { CAPTION_MAX_LENGTH } from "./caption-limits";

/** Vom Storage unterstützte Bild-Medientypen für die Vision-Eingabe. */
export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

/** Eingabe für die Caption-Generierung eines einzelnen Mediums. */
export type CaptionInput = {
  mediaType: "photo" | "video";
  keyword: string | null;
  /** base64-kodiertes Bild (nur Foto). Bei Video ungenutzt — siehe unten. */
  imageBase64?: string;
  imageMediaType?: ImageMediaType;
};

const SYSTEM_PROMPT =
  "Du schreibst sehr kurze Bildunterschriften für ein Handwerks-Booklet. " +
  "Max ~8 Wörter, ein knappes Fragment, beschreibt was im Bild passiert (Bild + Stichwort). " +
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
 * Erzeugt eine kurze deutsche Bildunterschrift (memorybook-Stil) für ein Medium.
 *
 * - FOTO: Bild (base64) + Stichwort gehen als Vision-Input an Haiku.
 * - VIDEO: aktuell **nur** das Stichwort — die Frame-Extraktion folgt später mit
 *   dem Reel. Ein Video ohne Stichwort liefert daher einen leeren String zurück
 *   (manuell nachzutragen), ohne die API zu bemühen.
 *
 * Gibt den reinen Caption-Text zurück (getrimmt, ohne Anführungszeichen/Punkt,
 * auf `CAPTION_MAX_LENGTH` begrenzt).
 */
export async function generateCaption(input: CaptionInput): Promise<string> {
  // Video ohne Bild und ohne Stichwort → nichts, woraus eine Caption entstehen kann.
  if (input.mediaType === "video" && !input.keyword) {
    return "";
  }

  const hasImage = input.mediaType === "photo" && Boolean(input.imageBase64);

  const content: Anthropic.ContentBlockParam[] = [];
  if (hasImage && input.imageBase64) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: input.imageMediaType ?? "image/jpeg",
        data: input.imageBase64,
      },
    });
  }

  const keywordLine = input.keyword
    ? `Stichwort: ${input.keyword}`
    : "Kein Stichwort angegeben.";
  const subject = input.mediaType === "photo" ? "dieses Foto" : "diesen Video-Clip";
  content.push({
    type: "text",
    text: `Schreibe eine sehr kurze Bildunterschrift für ${subject}. ${keywordLine}`,
  });

  const anthropic = getAnthropic();
  // Haiku 4.5 unterstützt KEIN effort/adaptives Thinking — schlichter Request.
  const message = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 64,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join(" ");

  return cleanCaption(text);
}
