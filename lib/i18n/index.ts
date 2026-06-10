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

/**
 * Typsicherer Übersetzungs-Helfer: `t("de", "app.name")`.
 * Der Schlüssel wird gegen die Dictionary-Struktur geprüft, der Rückgabetyp
 * entspricht dem Wert am Pfad.
 */
export function t<P extends DictKey<Dictionary>>(
  locale: Locale,
  key: P,
): DictValue<Dictionary, P> {
  const value = key
    .split(".")
    .reduce<unknown>(
      (acc, part) => (acc as Record<string, unknown>)[part],
      getDictionary(locale),
    );

  return value as DictValue<Dictionary, P>;
}
