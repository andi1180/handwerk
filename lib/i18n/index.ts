import { de } from "./de";
import type { DictKey, DictValue, Locale } from "./types";

export type { Locale } from "./types";

/** Standardsprache der App. */
export const DEFAULT_LOCALE: Locale = "de";

/** Kanonischer Dictionary-Typ, abgeleitet aus dem deutschen Dictionary. */
export type Dictionary = typeof de;

/**
 * Registry aller Sprachen. Neue Sprache = neue Dict-Datei importieren und hier
 * eintragen — `Record<Locale, Dictionary>` erzwingt vollständige Übersetzung.
 */
const dictionaries: Record<Locale, Dictionary> = {
  de,
};

/** Liefert das vollständige Dictionary einer Sprache. */
export function getDictionary(locale: Locale = DEFAULT_LOCALE): Dictionary {
  return dictionaries[locale];
}

/** Platzhalter-Werte für die Interpolation, z. B. `{ name: "…", max: 20 }`. */
export type TParams = Record<string, string | number>;

/**
 * Typsicherer Übersetzungs-Helfer: `t("de", "app.name")`.
 * Der Schlüssel wird gegen die Dictionary-Struktur geprüft, der Rückgabetyp
 * entspricht dem Wert am Pfad.
 *
 * Optionale Interpolation: `t("de", "portal.welcome", { name })` ersetzt
 * `{name}`/`{max}`/… im Template. Wird `params` übergeben, ist der Rückgabetyp
 * `string` (das Leaf-Literal geht durch die Ersetzung verloren).
 */
export function t<P extends DictKey<Dictionary>>(
  locale: Locale,
  key: P,
): DictValue<Dictionary, P>;
export function t<P extends DictKey<Dictionary>>(
  locale: Locale,
  key: P,
  params: TParams,
): string;
export function t<P extends DictKey<Dictionary>>(
  locale: Locale,
  key: P,
  params?: TParams,
): DictValue<Dictionary, P> | string {
  const value = key
    .split(".")
    .reduce<unknown>(
      (acc, part) => (acc as Record<string, unknown>)[part],
      getDictionary(locale),
    ) as DictValue<Dictionary, P>;

  if (!params) return value;

  return (value as string).replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
