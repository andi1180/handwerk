/**
 * Website-Veröffentlichung — geteilte Wertebereiche und Guards (Migration 0015).
 *
 * PLAIN-Modul ohne Server-Imports/Secrets ⇒ von der Client-Komponente UND vom
 * Route Handler importierbar. Damit ist die Optionsliste der Oberfläche
 * dieselbe Liste, gegen die der Server validiert (Muster wie
 * `lib/settings/options.ts`).
 *
 * ⚠️ VORBEREITENDER BAUSTEIN: Es existiert KEINE Anbindung an die Website —
 *    kein API-Call, kein Webhook, kein Medien-Versand. Diese Werte werden
 *    ausschließlich in Handwerks eigener DB gespeichert.
 *
 * ⚠️ NICHT VERWECHSELN: `WebsiteCategory` (Art der Arbeit am AUFTRAG) ist
 *    etwas anderes als `MediaCategory` aus `queries.ts` (before/after/process,
 *    Bild-Einteilung am MEDIUM, Migration 0010). Deshalb heißt das Feld in der
 *    Oberfläche durchgehend „Website-Kategorie", nie nur „Kategorie".
 */

/* ─────────────────────────────────────────────────────────────────────────
   Website-Kategorie — Art der Arbeit.

   Spiegel des Enums `verwandlungsart` im Website-Repo (atelier-dax-web,
   lib/database.types.ts): 'aenderung' | 'redesign' | 'upcycling'.
   Zusätzlich per CHECK-Constraint in Migration 0015 verankert (kleiner,
   stabiler Wertebereich).
   ───────────────────────────────────────────────────────────────────────── */

export const WEBSITE_CATEGORIES = [
  { value: "aenderung", label: "Änderung" },
  { value: "redesign", label: "Redesign" },
  { value: "upcycling", label: "Upcycling" },
] as const;

export type WebsiteCategory = (typeof WEBSITE_CATEGORIES)[number]["value"];

/** Standard beim erstmaligen Einschalten (= DB-Default aus 0015). */
export const DEFAULT_WEBSITE_CATEGORY: WebsiteCategory = "aenderung";

export function isWebsiteCategory(value: unknown): value is WebsiteCategory {
  return WEBSITE_CATEGORIES.some((c) => c.value === value);
}

/* ─────────────────────────────────────────────────────────────────────────
   Kleidungsart.

   ⚠️ DIESE WERTE SIND NICHT ERFUNDEN. Sie sind 1:1 aus dem Website-Repo
   übernommen (atelier-dax-web, lib/kleidungsarten.ts + lib/database.types.ts,
   Enum `kleidungsart`), Stand 07.08.2026 — inklusive Reihenfolge, die dort
   eine bewusste Entscheidung ist (Mantel-Cluster vorn, „Sonstiges" zuletzt).
   Die Beschriftungen sind das dortige `einzahl`-Feld.

   ⚠️ DAS ENUM WÄCHST DRÜBEN: 0031 jacke_gilet, 0032 pullover, 0035 sakko.
   Diese Liste ist deshalb bewusst die EINE Quelle (kein DB-CHECK in 0015) —
   ein neuer Wert drüben ist hier eine Zeile, keine Migration. Wer nachzieht,
   gleicht gegen atelier-dax-web/lib/kleidungsarten.ts ab.
   ───────────────────────────────────────────────────────────────────────── */

export const WEBSITE_CLOTHING_TYPES = [
  { value: "mantel", label: "Mantel" },
  { value: "jacke_gilet", label: "Jacke/Gilet" },
  { value: "kleid", label: "Kleid" },
  { value: "hose", label: "Hose" },
  { value: "rock", label: "Rock" },
  { value: "anzug", label: "Anzug" },
  { value: "sakko", label: "Sakko" },
  { value: "bluse", label: "Bluse" },
  { value: "pullover", label: "Pullover" },
  { value: "sonstiges", label: "Sonstiges" },
] as const;

export type WebsiteClothingType =
  (typeof WEBSITE_CLOTHING_TYPES)[number]["value"];

export function isWebsiteClothingType(
  value: unknown,
): value is WebsiteClothingType {
  return WEBSITE_CLOTHING_TYPES.some((c) => c.value === value);
}

/* ─────────────────────────────────────────────────────────────────────────
   Zahlenfelder.
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Prüft einen Preis-Wert: endliche Zahl > 0.
 *
 * `> 0`, weil die Website `preis_cent check (> 0)` führt — eine Zeile mit
 * Preis 0 wäre dort nicht anlegbar. Die Regel gilt nur, WENN
 * `website_visible = true`; in der DB steht die Spalte ohne CHECK
 * (Begründung im Kopf von Migration 0015).
 *
 * Für Arbeitszeit gilt seit dem 10.08.2026 eine andere Grenze — siehe
 * `isNonNegativeNumber`.
 */
export function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Prüft einen Arbeitszeit-Wert: endliche Zahl >= 0.
 *
 * Anders als bei Preis ist hier `0` gültig (Auftrag Andreas, 10.08.2026):
 * `stunden = 0` heißt auf der Website „nicht anzeigen", nicht „unbrauchbare
 * Angabe" — die Website selbst blendet den Arbeitszeit-Absatz dann aus,
 * anstatt den Wert abzulehnen (atelier-dax-web, Migration 0039, CHECK dort
 * auf `stunden >= 0` gelockert). Negative Werte bleiben ungültig. Die Regel
 * gilt nur, WENN `website_visible = true`; in der DB steht die Spalte ohne
 * CHECK (Begründung im Kopf von Migration 0015).
 */
export function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Parst eine Eingabe (Zahl oder String aus einem `type="number"`-Feld) zu einer
 * Zahl. Leerer/ungültiger Wert ⇒ `null` — der Aufrufer entscheidet, ob das ein
 * Fehler ist. Komma wird als Dezimaltrenner akzeptiert (deutsche Tastatur).
 */
export function parseNumericInput(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(",", ".");
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/* ─────────────────────────────────────────────────────────────────────────
   Website-Text — „Was wurde gemacht" (Migration 0017).
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Mindestlänge des Website-Textes in Zeichen, nach dem Trimmen.
 *
 * ⚠️ DIE ZAHL IST NICHT GEGRIFFEN: Der ERSTE SATZ dieses Textes wird drüben
 *    automatisch zur Bildunterschrift unter dem Vorher/Nachher-Paar. Die dort
 *    gemessene Zielgröße für Bildunterschriften liegt bei 60–95 Zeichen
 *    (atelier-dax-web, Etappe 4). Bei einer Untergrenze unterhalb davon
 *    verbrauchte die Bildunterschrift den gesamten Text, und für „Was wurde
 *    gemacht" bliebe nichts übrig. 80 sichert einen ganzen Satz plus etwas
 *    dahinter.
 *
 * KEINE Obergrenze — für die Glättung drüben ist zu viel Material besser als
 * zu wenig.
 */
export const WEBSITE_TEXT_MIN_LENGTH = 80;

/**
 * Prüft den Website-Text: String mit mindestens `WEBSITE_TEXT_MIN_LENGTH`
 * Zeichen nach dem Trimmen.
 *
 * Die Regel gilt nur, WENN `website_visible = true` — bei ausgeschaltetem
 * Schalter ist das Feld beliebig, auch leer. In der DB steht die Spalte ohne
 * CHECK (Begründung im Kopf von Migration 0017), genau wie die zwei
 * Zahlenfelder aus 0015.
 */
export function isValidWebsiteText(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length >= WEBSITE_TEXT_MIN_LENGTH
  );
}

/**
 * Trimmt den Website-Text für die Speicherung. Setzt voraus, dass
 * `isValidWebsiteText` bereits zugestimmt hat.
 *
 * Gespeichert wird die getrimmte Fassung, weil genau sie geprüft wurde — sonst
 * stünden 80 geprüfte Zeichen und ein davon abweichender Datenbankinhalt
 * nebeneinander.
 */
export function normalizeWebsiteText(value: string): string {
  return value.trim();
}
