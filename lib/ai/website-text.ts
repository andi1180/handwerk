import type Anthropic from "@anthropic-ai/sdk";
import type { createClient } from "@/lib/supabase/server";
import { displayCaption } from "@/lib/booklet/caption";
import { orderBookletMedia } from "@/lib/booklet/media-order";
import type { MediaCategory } from "@/lib/orders/queries";
import { getAnthropic, HAIKU_MODEL } from "./anthropic";
import { languageName } from "./language";

/**
 * Textentwurf „Was wurde gemacht“ für das öffentliche Website-Archiv
 * (`orders.website_text`, Migration 0017).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WARUM ES DIESEN ENTWURF GIBT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 0017 hat den Text bewusst dem Menschen gegeben: `item_description` allein
 * trägt nicht (Maße, Kürzel, Tippfehler — eine Annahmenotiz vom Tresen). Diese
 * Diagnose bleibt gültig; sie hat sich nur um eine Zutat verschoben. Der
 * Entwurf hier stützt sich NICHT auf die Notiz allein, sondern zuerst auf die
 * BILDUNTERSCHRIFTEN — die beschreiben, anders als die Annahmenotiz, das
 * tatsächlich Sichtbare am Stück.
 *
 * ⚠️ Der Entwurf ersetzt den Menschen nicht, er gibt ihm einen Anfang. Alina
 *    korrigiert ihn; korrigiert sie nicht, korrigiert Andreas auf der Website.
 *    Damit man weiß, welche Texte noch niemand angesehen hat, merkt sich die
 *    Datenbank das Kennzeichen `orders.website_text_ki_entwurf` (0018).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MODELL UND SCHLÜSSEL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Haiku 4.5 über den bereits vorhandenen, prozessweit gecachten Client
 * (`lib/ai/anthropic.ts`) — derselbe `ANTHROPIC_API_KEY` wie die
 * Bildunterschriften-Erzeugung, bewusst KEIN zweiter Schlüssel (das Volumen
 * rechtfertigt den Aufwand nicht).
 *
 * Server-only: Der Schlüssel darf nie in den Client. Dieses Modul importieren
 * ausschließlich Route Handler.
 */

/** Server-Client-Typ (AUTHENTICATED, RLS) — abgeleitet aus `createClient`. */
type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Zeitgrenze für den Modell-Aufruf. Der Aufruf blockiert eine Nutzer-Aktion
 * (Schalter umlegen bzw. Speichern), deshalb eine harte Grenze statt der
 * SDK-Vorgabe — eine hängende Anfrage soll als klarer Fehler enden, nicht als
 * unbestimmtes Warten.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Ein Wiederholungsversuch. Zwei wären bei 30 s Zeitgrenze im ungünstigsten
 * Fall über eine Minute Wartezeit für jemanden, der vor dem Formular sitzt.
 */
const MAX_RETRIES = 1;

/** Wie die Bildarten im Prompt benannt werden (0010: before/after/process). */
const CATEGORY_LABEL: Record<MediaCategory, string> = {
  before: "Vorher",
  after: "Nachher",
  process: "Während der Arbeit",
};

const SYSTEM_PROMPT =
  "Du schreibst einen kurzen, sachlichen Text für das öffentliche Archiv eines " +
  "Schneiderateliers. Überschrift dort: „Was wurde gemacht“. Eine Leserin, die " +
  "das Stück nicht kennt und nicht im Atelier war, soll verstehen, welche Arbeit " +
  "an dem Kleidungsstück gemacht wurde.\n\n" +
  "FORM\n" +
  "- Ganze Sätze, sachlich und neutral. Kein Werbe-Ton, keine Ausrufezeichen, " +
  "keine Emojis, keine Aufzählung.\n" +
  "- Höflichkeitsform: Sie. NIEMALS „du“ oder „dein“.\n" +
  "- Zwei bis drei Sätze.\n" +
  "- Der ERSTE SATZ steht auf der Website als Bildunterschrift unter dem " +
  "Vorher/Nachher-Bildpaar: kurz (etwa 60–95 Zeichen), für sich allein " +
  "verständlich, nennt das Kleidungsstück und die Arbeit daran.\n" +
  "- Die folgenden Sätze beschreiben die Arbeit etwas genauer.\n\n" +
  "WAS NICHT HINEINGEHÖRT — das Material stammt aus einem INTERNEN Booklet und " +
  "war nie für Fremde gedacht. Filtere heraus:\n" +
  "- Namen von Personen (Kundinnen, Kunden, Mitarbeitende).\n" +
  "- Namen anderer Betriebe, Ateliers oder Werkstätten, und jede Bewertung " +
  "fremder Arbeit („bei einer anderen Schneiderei“, „schlecht genäht“).\n" +
  "- Preise, Beträge, Maße, Stückzahlen, Zahlen, Kürzel und interne Vermerke. " +
  "Auch NICHT ausgeschrieben: nicht „anderthalb Zentimeter“, nicht „zwei " +
  "Jacken“. Schreibe „gekürzt“ statt „um X gekürzt“.\n" +
  "- Werkstatt-Jargon und Abkürzungen — benenne die Arbeit in Worten, die " +
  "jemand ohne Fachkenntnis versteht.\n" +
  "- Alles, was nach interner Notiz klingt statt nach Beschreibung.\n\n" +
  "WAHRHEIT\n" +
  "- Beschreibe NUR, was aus den Bildunterschriften und der Annahmenotiz " +
  "hervorgeht. Erfinde keine Materialien, keine Farben, keine Gefühle, keine " +
  "Zufriedenheit der Kundin.\n" +
  "- Ist das Material dünn, widersprüchlich oder scheinen die Bildunterschriften " +
  "nicht zusammenzupassen, schreibe TROTZDEM einen kurzen, ehrlichen Text aus " +
  "dem, was am ehesten zum Kleidungsstück gehört. Brich NICHT ab, frage NICHT " +
  "nach, entschuldige dich NICHT, bewerte NICHT die Eingabe und erkläre nicht, " +
  "dass die Angaben knapp sind — schreibe einfach knapper und allgemeiner.\n\n" +
  "Antworte AUSSCHLIESSLICH mit dem Text selbst — keine Überschrift, keine " +
  "Anführungszeichen, keine Vor- oder Nachbemerkung.";

/** Eine Bildunterschrift, wie sie in den Prompt geht. */
export type WebsiteTextCaption = {
  category: MediaCategory;
  text: string;
};

export type WebsiteTextInput = {
  /** Bildunterschriften in Booklet-Reihenfolge (before → process → after). */
  captions: readonly WebsiteTextCaption[];
  /** Annahmenotiz aus roapp — Nebenquelle, nicht die Hauptquelle. */
  itemDescription: string | null;
  /** Auftragssprache (§15). */
  language: string;
};

/**
 * Umschließende Anführungszeichen entfernen, Leerraum vereinheitlichen.
 *
 * Bewusst SCHONEND: Anders als bei den Bildunterschriften ist hier ein
 * mehrsätziger Fließtext das Ziel — Satzzeichen am Ende bleiben stehen, und
 * gekürzt wird nichts (das Feld hat keine Obergrenze, siehe 0017).
 */
function cleanDraft(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^["“”'»«]+|["“”'»«]+$/g, "").trim();
  // Absatzumbrüche zu einem einfachen Leerzeichen: Das Feld ist ein kurzer
  // Fließtext, und die Website setzt ihn ohnehin am Stück.
  text = text.replace(/\s*\n\s*/g, " ");
  text = text.replace(/[ \t]+/g, " ");
  return text.trim();
}

/**
 * Muster einer META-ANTWORT: Das Modell hat über die Aufgabe gesprochen, statt
 * den Text zu liefern — es hat zurückgefragt, die Eingabe bewertet oder
 * abgelehnt. Gleiche Idee wie `isMetaResponse` bei den Bildunterschriften
 * ([lib/ai/captions.ts](lib/ai/captions.ts)), nur auf diese Textsorte
 * zugeschnitten: Die dortige Längen-Regel entfällt (zwei bis drei Sätze sind
 * hier normal), dafür zählen Verweise auf das Eingabematerial.
 *
 * ⚠️ NICHT theoretisch, sondern gemessen: Bei einem Auftrag mit
 *    zusammenhanglosen Bildunterschriften antwortete das Modell mit
 *    „… Ich kann keinen sachlichen, ehrlichen Text schreiben … Bitte prüfen
 *    Sie die Eingabe: Gehören alle Bilder zu einem Auftrag?" — 653 Zeichen, die
 *    an der 80-Zeichen-Prüfung mühelos vorbeikommen und als Archivtext eines
 *    Kunden online gegangen wären.
 *
 * Die Muster zielen auf das, was ein Archivtext NIE tut: eine Frage stellen, in
 * der Ich-Form über das eigene Können sprechen, oder das Rohmaterial benennen
 * (ein Text über ein Kleidungsstück erwähnt keine „Bildunterschriften").
 */
const META_MUSTER: readonly RegExp[] = [
  /\?/,
  /\bich (kann|konnte|habe keine|sehe|benötige|brauche|weiß)\b/i,
  /\b(tut mir leid|entschuldigung|leider kann|leider lässt)\b/i,
  /\b(bildunterschrift|annahmenotiz|eingabe|rohmaterial|angaben (reichen|sind zu))\b/i,
  /\bals (ki|sprachmodell|assistent)\b/i,
];

function istMetaAntwort(text: string): boolean {
  return META_MUSTER.some((muster) => muster.test(text));
}

/**
 * Erzeugt den Textentwurf. Wirft bei API-Fehler, Zeitüberschreitung, fehlendem
 * Schlüssel — und auch dann, wenn das Modell nichts Verwertbares liefert: Der
 * Aufrufer übersetzt das in `text_generation_failed` und speichert NICHTS.
 *
 * ⚠️ Ein KURZER Entwurf ist ausdrücklich KEIN Fehler. Er wird zurückgegeben und
 *    läuft danach durch dieselbe 80-Zeichen-Prüfung wie ein von Hand getippter
 *    Text (`isValidWebsiteText`) — ein zu dünner Auftrag scheitert also am
 *    Umlegen, statt mit einem Halbsatz online zu gehen.
 */
export async function generateWebsiteTextDraft(
  input: WebsiteTextInput,
): Promise<string> {
  const anthropic = getAnthropic();

  const message = await anthropic.messages.create(
    {
      model: HAIKU_MODEL,
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(input) }],
    },
    { timeout: REQUEST_TIMEOUT_MS, maxRetries: MAX_RETRIES },
  );

  const raw = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join(" ");

  const text = cleanDraft(raw);
  if (text.length === 0) {
    // Leere Antwort ist etwas anderes als ein kurzer Entwurf: Hier gibt es
    // nichts zu speichern und nichts zu prüfen.
    throw new Error("website text draft: empty model response");
  }
  if (istMetaAntwort(text)) {
    /* Eine Rückfrage ist KEIN Entwurf. Sie ist lang genug, um durch die
       80-Zeichen-Prüfung zu kommen — ohne diesen Wächter stünde sie als
       Archivtext im Netz. Der Aufrufer meldet `text_generation_failed`; die
       Oberfläche bietet „Erneut erzeugen" an (die Ablehnung hängt auch am
       Zufall der Stichprobe), sonst schreibt der Mensch selbst. */
    throw new Error(
      `website text draft: meta response instead of a draft — ${text.slice(0, 200)}`,
    );
  }
  return text;
}

/**
 * Baut die Nutzer-Nachricht.
 *
 * ⚠️ Beide Quellen stehen in einem abgegrenzten Block (`<<< >>>`), genau wie
 *    der Betriebskontext im Intro und im Bewertungsentwurf: Sie sind DATEN, aus
 *    denen beschrieben wird — keine Anweisungen. Was darin steht, darf die
 *    Regeln oben nicht überschreiben.
 */
function buildUserPrompt(input: WebsiteTextInput): string {
  const teile: string[] = [];

  if (input.captions.length > 0) {
    const zeilen = input.captions
      .map((c) => `- [${CATEGORY_LABEL[c.category]}] ${c.text}`)
      .join("\n");
    teile.push(
      "Bildunterschriften der Fotos und Videos dieses Auftrags, in der " +
        "Reihenfolge des Booklets (HAUPTQUELLE — sie beschreiben, was am Stück " +
        `zu sehen ist):\n<<<\n${zeilen}\n>>>`,
    );
  } else {
    teile.push(
      "Zu diesem Auftrag gibt es keine Bildunterschriften. Stütze dich auf die " +
        "Annahmenotiz und bleibe entsprechend knapp und allgemein.",
    );
  }

  const notiz = input.itemDescription?.trim();
  if (notiz) {
    teile.push(
      "Annahmenotiz vom Tresen (NEBENQUELLE, roh: enthält oft Maße, Kürzel und " +
        "Tippfehler — entnimm ihr nur die Art der Arbeit und das Kleidungsstück, " +
        `übernimm NICHTS davon wörtlich):\n<<<\n${notiz}\n>>>`,
    );
  }

  teile.push(`Sprache der Ausgabe: ${languageName(input.language)}.`);
  return teile.join("\n\n");
}

/** Die Felder, die für einen Entwurf aus dem Auftrag gebraucht werden. */
export type WebsiteTextOrder = {
  id: string;
  item_description: string | null;
  language: string;
};

/**
 * Lädt die Bildunterschriften des Auftrags und erzeugt daraus den Entwurf.
 *
 * EINE Quelle für beide Wege in den Entwurf: den Klick auf den Schalter
 * (`POST …/website-text`, damit Alina den Entwurf noch vor dem Speichern sieht)
 * und das Umlegen selbst (`PATCH …/[id]` als Auffangnetz, wenn beim Speichern
 * immer noch kein Text dasteht). Beide erzeugen damit denselben Text aus
 * denselben Daten.
 *
 * ⚠️ Als Text eines Mediums gilt `displayCaption` (KI-Caption, sonst das
 *    getippte Stichwort) — dieselbe Quelle, aus der Web-Story und Reel ihre
 *    Overlays nehmen. Am Bestand ist nur bei rund der Hälfte der Fotos eine
 *    Caption gesetzt (Messung 07.08.2026); das Stichwort als Rückfall bewahrt
 *    hier also den halben Rohstoff.
 *
 * Zugriff über den übergebenen AUTHENTICATED Client (RLS) — kein
 * `service_role`. Wirft weiter, was `generateWebsiteTextDraft` wirft.
 */
export async function websiteTextDraftForOrder(
  supabase: ServerClient,
  order: WebsiteTextOrder,
): Promise<string> {
  const { data: media } = await supabase
    .from("order_media")
    .select("caption, keyword, category, sort_order")
    .eq("order_id", order.id)
    .order("sort_order", { ascending: true })
    .returns<
      {
        caption: string | null;
        keyword: string | null;
        category: MediaCategory;
        sort_order: number;
      }[]
    >();

  // Booklet-Reihenfolge (before → process → after): So liest sich die Abfolge
  // wie die Arbeit selbst — Ausgangszustand, Arbeit, Ergebnis.
  const captions: WebsiteTextCaption[] = orderBookletMedia(media ?? [])
    .map((m) => ({ category: m.category, text: displayCaption(m) }))
    .filter((c): c is WebsiteTextCaption => c.text !== null);

  return generateWebsiteTextDraft({
    captions,
    itemDescription: order.item_description,
    language: order.language,
  });
}
