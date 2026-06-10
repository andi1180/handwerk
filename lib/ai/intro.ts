import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, SONNET_MODEL } from "./anthropic";

/**
 * Eingabe für das Booklet-Intro (Schritt 8a-1). Speist sich aus der
 * Stück-Beschreibung des Auftrags und den vorhandenen Bild-Captions.
 */
export type IntroInput = {
  /** `orders.item_description` — der KI-Kontext zum Werkstück (optional). */
  itemDescription: string | null;
  /** Vorhandene Captions der Medien (leere/fehlende sind bereits ausgefiltert). */
  captions: string[];
  /** Sprache der Ausgabe (= Auftragssprache, §15). MVP: nur `de` befüllt. */
  language: string;
};

/** Generiertes Intro: kurzer Titel + 1–2 Sätze Beschreibung. */
export type IntroResult = {
  title: string;
  description: string;
};

/**
 * Wird geworfen, wenn Sonnet kein verwertbares JSON liefert. Der Route Handler
 * übersetzt das in eine klare 502 (statt eines stillen Fehlers).
 */
export class IntroParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntroParseError";
  }
}

/** Sprach-Anzeigenamen für den Prompt (§15: neue Sprache = Config, kein Refactor). */
const LANGUAGE_NAMES: Record<string, string> = { de: "Deutsch" };
function languageName(language: string): string {
  return LANGUAGE_NAMES[language] ?? language;
}

function systemPrompt(language: string): string {
  return (
    "Du schreibst den Intro-Text (den ersten Eindruck) für ein hochwertiges " +
    "Handwerks-Booklet, das die Verwandlung eines Werkstücks zeigt. Erzeuge " +
    "einen kurzen, einladenden Titel (höchstens ~6 Wörter) und eine Beschreibung " +
    "aus 1–2 Sätzen, die die Transformation des Stücks beschreibt. Stütze dich " +
    "auf die Stück-Beschreibung und die vorhandenen Bildunterschriften. " +
    "Hochwertig und konkret, kein Marketing-Sprech, keine Übertreibungen, keine " +
    "Emojis, keine Anführungszeichen. " +
    `Sprache der Ausgabe: ${languageName(language)}. ` +
    'Antworte AUSSCHLIESSLICH mit purem JSON in genau dieser Form: ' +
    '{"title": "...", "description": "..."} — kein Markdown, keine Code-Fences, ' +
    "kein zusätzlicher Text."
  );
}

function userPrompt(input: IntroInput): string {
  const parts: string[] = [];
  parts.push(
    input.itemDescription
      ? `Beschreibung des Stücks: ${input.itemDescription}`
      : "Keine Beschreibung des Stücks angegeben.",
  );
  if (input.captions.length > 0) {
    parts.push(
      "Bildunterschriften der einzelnen Aufnahmen:\n" +
        input.captions.map((c) => `- ${c}`).join("\n"),
    );
  } else {
    parts.push("Keine Bildunterschriften vorhanden.");
  }
  return parts.join("\n\n");
}

/** Entfernt umschließende ```-Fences und schneidet auf das erste JSON-Objekt zu. */
function extractJson(raw: string): string {
  let text = raw.trim();
  // Code-Fences (```json … ``` oder ``` … ```) defensiv entfernen.
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "").trim();
  }
  // Falls Sonnet doch Prosa drumherum schreibt: auf das erste {...} eingrenzen.
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) {
    text = text.slice(first, last + 1);
  }
  return text;
}

/** JSON defensiv parsen + Form prüfen; bei jedem Fehler `IntroParseError`. */
function parseIntro(raw: string): IntroResult {
  let obj: unknown;
  try {
    obj = JSON.parse(extractJson(raw));
  } catch {
    throw new IntroParseError("intro_json_invalid");
  }
  if (!obj || typeof obj !== "object") {
    throw new IntroParseError("intro_json_not_object");
  }
  const rec = obj as Record<string, unknown>;
  const title = typeof rec.title === "string" ? rec.title.trim() : "";
  const description =
    typeof rec.description === "string" ? rec.description.trim() : "";
  if (!title || !description) {
    throw new IntroParseError("intro_fields_missing");
  }
  return { title, description };
}

/**
 * Erzeugt das Booklet-Intro (Titel + Beschreibung) mit Sonnet 4.6.
 *
 * Sonnet soll NUR JSON liefern; wir parsen defensiv (Fence-Strip + try/catch).
 * Bei einem Parse-Fehler wirft die Funktion `IntroParseError` (Route → 502).
 * Reine Text-Eingabe (item_description + Captions) — kein Bild/Vision.
 */
export async function generateIntro(input: IntroInput): Promise<IntroResult> {
  const anthropic = getAnthropic();
  const message = await anthropic.messages.create({
    model: SONNET_MODEL,
    max_tokens: 300,
    system: systemPrompt(input.language),
    messages: [{ role: "user", content: userPrompt(input) }],
  });

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  return parseIntro(text);
}
