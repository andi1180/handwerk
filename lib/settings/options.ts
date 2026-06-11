/**
 * Konstanten, Optionen & Validatoren für das Settings-Modul (Schritt 5a).
 *
 * Geteilt zwischen `getCurrentBusiness` (Defaults beim Lesen), Settings-Form
 * (Auswahl + Client-Validierung) und Route Handler (Server-Validierung), damit
 * Auswahllisten und Grenzen an genau einer Stelle definiert sind.
 */

/** Auswählbare Schriftarten fürs Branding (erste = Default). */
export const FONT_OPTIONS = [
  "Plus Jakarta Sans",
  "Inter",
  "Lora",
  "Manrope",
] as const;
export type FontOption = (typeof FONT_OPTIONS)[number];

/** Auslieferungsmodus: manuell (Default) oder automatisch. */
export const DELIVERY_MODES = ["manual", "auto"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

/** Hintergrund-Slots im Booklet (Schritt 7c): Intro- und Outro-Seite. */
export const BACKGROUND_SLOTS = ["intro", "outro"] as const;
export type BackgroundSlot = (typeof BACKGROUND_SLOTS)[number];

/** Grenzen + Default für die maximale Videolänge (Sekunden), Ceiling 30. */
export const VIDEO_SECONDS = { min: 5, max: 30, default: 20 } as const;

/**
 * Grenzen + Default für die Anzahl Fotos pro Auftrag (Schritt 8c). `max` ist das
 * harte **Plattform-Ceiling** (Kostenschutz; wandert später ins Admin-Portal) —
 * der pro-Betrieb konfigurierte Wert ist die Einstellung darunter (`default`).
 * Analog zu `VIDEO_SECONDS`.
 */
export const PHOTO_COUNT = { min: 1, max: 20, default: 10 } as const;

/** Grenzen + Default für die Anzahl Videos pro Auftrag — Ceiling-Logik wie `PHOTO_COUNT`. */
export const VIDEO_COUNT = { min: 1, max: 10, default: 3 } as const;

/** Grenzen + Default für die Aufbewahrung (Monate); deckt sich mit der DB-Check. */
export const RETENTION_MONTHS = { min: 1, max: 120, default: 12 } as const;

/** Gültiges 6-stelliges Hex (#RRGGBB) — Branding-Farben. */
export const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Längen-Grenzen für die Booklet-Inhalt-Texte (Schritt 7b) und den
 * Betriebs-KI-Kontext (Schritt 8a-1b). Geteilt von Settings-Form
 * (Client-Validierung + `maxLength`) und Route Handler (Server-Validierung),
 * damit beide Seiten exakt dasselbe Limit erzwingen.
 */
export const CONTENT_LIMITS = {
  introTagline: 80,
  outroMessage: 300,
  contactPhone: 40,
  aiContext: 500,
} as const;

/** Pragmatisches E-Mail-Format für die öffentliche Kontakt-Mail (Outro). */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Typ-Guard: sieht der String wie eine E-Mail-Adresse aus? */
export function isEmailFormat(value: unknown): value is string {
  return typeof value === "string" && EMAIL_REGEX.test(value);
}

/** Typ-Guard: gültige Hex-Farbe (#RRGGBB)? */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_REGEX.test(value);
}

/** Typ-Guard: einer der erlaubten Schrift-Werte? */
export function isFontOption(value: unknown): value is FontOption {
  return (
    typeof value === "string" &&
    (FONT_OPTIONS as readonly string[]).includes(value)
  );
}

/** Typ-Guard: einer der erlaubten Auslieferungsmodi? */
export function isDeliveryMode(value: unknown): value is DeliveryMode {
  return (
    typeof value === "string" &&
    (DELIVERY_MODES as readonly string[]).includes(value)
  );
}

/** Typ-Guard: gültiger Hintergrund-Slot (intro/outro)? */
export function isBackgroundSlot(value: unknown): value is BackgroundSlot {
  return (
    typeof value === "string" &&
    (BACKGROUND_SLOTS as readonly string[]).includes(value)
  );
}

/**
 * Fixer Storage-Pfad eines Hintergrunds im Bucket `branding` (Schritt 7c).
 * Erstes Segment = `business_id` = Isolations-Grenze (Storage-RLS aus 0003).
 * Geteilt von Client-Upload und Route-Handler-Validierung, damit der Pfad nicht
 * driftet. `upsert = true` überschreibt das vorige Bild unter demselben Pfad.
 */
export function backgroundStoragePath(
  businessId: string,
  slot: BackgroundSlot,
): string {
  return `${businessId}/${slot}-bg.jpg`;
}

/** Standard-Branding, falls der Betrieb (noch) nichts gesetzt hat. */
export const DEFAULT_BRANDING = {
  primary_color: "#C4A95B",
  secondary_color: "#3A3A3A",
  font: FONT_OPTIONS[0],
  logo_per_page: false,
  logo_url: null,
  intro_bg_url: null,
  outro_bg_url: null,
} as const;

/**
 * jsonb-Wert → Record (alles andere → leeres Objekt). Geteilt von
 * `getCurrentBusiness` (Normalisierung) und den Settings-Route-Handlern
 * (READ-MERGE-WRITE des branding-jsonb), damit jsonb-Zugriffe sicher sind.
 */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
