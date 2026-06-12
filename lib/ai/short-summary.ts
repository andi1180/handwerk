import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, HAIKU_MODEL } from "./anthropic";
import { languageName } from "./language";

/**
 * Defensives Längen-Limit der Kurzbeschreibung. Der Prompt zielt auf ~3–6 Wörter;
 * dieser Cap fängt nur eine ausufernde Antwort ab (Server-only, kein Client-Bedarf —
 * die Kachel liest bloß das gespeicherte Feld).
 */
export const SHORT_SUMMARY_MAX_LENGTH = 60;

const SYSTEM_PROMPT =
  "Du fasst die Art einer Handwerks-/Schneiderarbeit in EINEM extrem kurzen Stichwort-" +
  "Fragment zusammen (etwa 3–6 Wörter), damit ein Mitarbeiter in der Auftragsliste auf " +
  "einen Blick sieht, worum es geht. Beispiel-Stil: \"Hose kürzen + enger\", " +
  "\"Reißverschluss Jacke tauschen\".\n\n" +
  "REGELN für den Roh-Input (interne Notiz des Handwerkers — kann Tippfehler, Dialekt, " +
  "Abkürzungen enthalten):\n" +
  "- Gib NUR die Art der Arbeit wieder, knapp und sachlich. Kein ganzer Satz, keine Anrede.\n" +
  "- IGNORIERE strikt: Preise, Zahlen, Maße (\"-2cm\", \"VM 110\"), Kürzel, interne Vermerke. " +
  "KEINE einzige Zahl darf im Ergebnis erscheinen.\n" +
  "- Übernimm NICHT Wortlaut/Stil der Notiz — verstehe die Arbeit und benenne sie sauber.\n" +
  "- Keine Anführungszeichen, keine Emojis, kein abschließender Punkt.\n" +
  "Antworte AUSSCHLIESSLICH mit dem Kurztext.";

/** Anführungszeichen + abschließenden Punkt entfernen, Whitespace kollabieren, kürzen. */
function cleanSummary(raw: string): string {
  let text = raw.trim();
  // Umschließende Anführungszeichen (gerade/typografisch) entfernen.
  text = text.replace(/^["“”'»«]+|["“”'»«]+$/g, "").trim();
  // Einen abschließenden Punkt entfernen (Fragment-Stil).
  text = text.replace(/\.+$/, "").trim();
  // Mehrfach-Whitespace/Zeilenumbrüche kollabieren.
  text = text.replace(/\s+/g, " ");
  if (text.length > SHORT_SUMMARY_MAX_LENGTH) {
    text = text.slice(0, SHORT_SUMMARY_MAX_LENGTH).trim();
  }
  return text;
}

/**
 * Erzeugt einen SEHR kurzen Einzeiler (Art der Arbeit, ~3–6 Wörter) aus der rohen
 * Auftrags-Beschreibung — für die Auftragskachel. Modell: Haiku 4.5 (schlichter
 * `messages.create`, kein Thinking/effort), Stil/Filter analog zum Intro-Prompt
 * (Preise/Zahlen/Maße/Kürzel werden ignoriert, keine Zahl im Output).
 *
 * Gibt `null` zurück, wenn `rawDescription` leer ist (kein sinnloser KI-Call) — oder
 * wenn das Modell nichts Verwertbares liefert. Sprache = Auftragssprache (§15).
 *
 * Wird EINMALIG bei der Auftragsanlage aufgerufen und gespeichert (`orders.short_summary`),
 * NICHT beim Rendern der Liste. Server-only (Anthropic-Key nie im Client).
 */
export async function generateShortSummary(
  rawDescription: string | null,
  language: string,
): Promise<string | null> {
  const description = rawDescription?.trim();
  // Leere Notiz ⇒ nichts zu beschreiben, kein Call.
  if (!description) return null;

  const anthropic = getAnthropic();
  const message = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 48,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          `Interne Notiz des Handwerkers (Roh-Input, nur Kontext):\n"${description}"\n\n` +
          `Sprache der Ausgabe: ${languageName(language)}.`,
      },
    ],
  });

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join(" ");

  const cleaned = cleanSummary(text);
  return cleaned.length > 0 ? cleaned : null;
}
