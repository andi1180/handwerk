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

/** Grenzen + Default für die maximale Videolänge (Sekunden), Ceiling 30. */
export const VIDEO_SECONDS = { min: 5, max: 30, default: 20 } as const;

/** Grenzen + Default für die Aufbewahrung (Monate); deckt sich mit der DB-Check. */
export const RETENTION_MONTHS = { min: 1, max: 120, default: 12 } as const;

/** Gültiges 6-stelliges Hex (#RRGGBB) — Branding-Farben. */
export const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

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

/** Standard-Branding, falls der Betrieb (noch) nichts gesetzt hat. */
export const DEFAULT_BRANDING = {
  primary_color: "#C4A95B",
  secondary_color: "#3A3A3A",
  font: FONT_OPTIONS[0],
  logo_per_page: false,
  logo_url: null,
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
