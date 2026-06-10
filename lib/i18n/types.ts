/**
 * Unterstützte Sprachen. MVP: nur Deutsch.
 * Erweiterung = neuen Locale-String ergänzen + passende Dict-Datei anlegen.
 */
export type Locale = "de";

/**
 * Alle gültigen, punktseparierten Schlüsselpfade durch ein (verschachteltes)
 * Dictionary-Objekt — z. B. "app.name". Liefert die Autocomplete-/Typsicherheit
 * für `t(locale, key)`.
 */
export type DictKey<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string
        ? K
        : `${K}.${DictKey<T[K]>}`;
    }[keyof T & string];

/** Der zu einem Pfad gehörende Wert-Typ (immer ein String-Leaf). */
export type DictValue<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? DictValue<T[K], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;
