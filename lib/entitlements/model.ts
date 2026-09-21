/**
 * Datenmodell der Entitlements (Arbeitspaket A2, ROLLOUT_PFLICHTENHEFT.md §4.1).
 *
 * Hier liegen: die Limit-Keys, die **Plattform-Obergrenzen**, die gemeinsame
 * Form von `tier_definitions` UND `businesses.entitlement_overrides`, das
 * Ergebnis-Objekt und die Lese-Helfer. Reines Daten-/Typ-Modul: kein
 * DB-Zugriff, keine Server-Imports (nur `import type`), damit `compute.ts`
 * rein und ohne Next-Runtime testbar bleibt.
 *
 * NOCH KEIN AUFRUFER — das Modul entsteht isoliert und wird erst in A7 an den
 * Schreibstellen (Upload-/Render-Route) verdrahtet.
 */
import {
  PHOTO_COUNT,
  VIDEO_COUNT,
  VIDEO_SECONDS,
  asRecord,
} from "@/lib/settings/options";
import type { BusinessSettings } from "@/lib/auth/current-business";

/**
 * Die Limit-Keys — bewusst eine **geschlossene** Menge, anders als die Features
 * (siehe `EntitlementFeatures`). Jeder Limit-Key braucht zwingend (a) eine
 * Plattform-Obergrenze im Code (E7: die Obergrenze gehört Andreas, nicht den
 * Daten) und (b) eine Betriebs-Einstellung als unterste Schicht. Ein Key ohne
 * Obergrenze hätte im `min()` der Formel keine harte Kappung — genau der
 * Kostenschutz, den E6 verlangt.
 *
 * Die Namen sind **identisch** zu den bereits existierenden Keys in
 * `businesses.settings` (`lib/settings/options.ts`, Schritt 8c) — keine
 * Doppelpflege, keine zweiten Namen für dieselbe Sache.
 */
export const ENTITLEMENT_LIMIT_KEYS = [
  "photo_max_count",
  "video_max_count",
  "video_max_seconds",
] as const;
export type EntitlementLimitKey = (typeof ENTITLEMENT_LIMIT_KEYS)[number];

/**
 * Plattform-Obergrenze je Limit-Key = **oberste** Schicht der Formel, hart.
 * Wiederverwendung der bereits vorhandenen `max`-Felder aus
 * `lib/settings/options.ts` (dort seit Schritt 8c ausdrücklich als
 * „Plattform-Ceiling" dokumentiert) — hier wird nichts neu erfunden.
 *
 * Bewusst als explizites Objekt-Literal (nicht per Schleife über
 * `ENTITLEMENT_LIMIT_KEYS` gebaut): ein neuer Limit-Key erzeugt damit einen
 * Compile-Fehler an genau dieser Stelle und kann nicht ohne Obergrenze
 * durchrutschen.
 */
export const PLATFORM_CEILINGS: Record<EntitlementLimitKey, number> = {
  photo_max_count: PHOTO_COUNT.max,
  video_max_count: VIDEO_COUNT.max,
  video_max_seconds: VIDEO_SECONDS.max,
};

/**
 * Feature-Flags. Bewusst ein **offener** `Record<string, boolean>` statt einer
 * festen Union: E9 verlangt, dass „welche Funktion in welchem Tier liegt"
 * jederzeit **ohne Deploy** änderbar ist. Ein neues Feature ist damit eine
 * Zeile in `tier_definitions.features`, kein Code-Release.
 *
 * Unbekannter Key ⇒ `false` (deny-by-default, siehe `hasFeature`). Welche
 * Features es überhaupt gibt, ist offen (O1) — deshalb steht hier keine Liste.
 */
export type EntitlementFeatures = Record<string, boolean>;

/**
 * Die gemeinsame Form von **Tier-Vorgabe** und **Betriebs-Ausnahme**. Beide
 * Quellen werden absichtlich in dieselbe Struktur normalisiert, damit genau
 * eine Merge-Logik auf beide passt:
 *
 * - `tier_definitions` hält sie in **zwei Spalten** (`limits`, `features`),
 * - `businesses.entitlement_overrides` in **einem** jsonb-Objekt der Form
 *   `{ "limits": { … }, "features": { … } }`.
 *
 * Beispiel für `entitlement_overrides` (Kulanz: mehr Fotos + Beta-Feature):
 * ```json
 * { "limits": { "photo_max_count": 15 }, "features": { "beta_website": true } }
 * ```
 *
 * `limits` ist `Partial`: ein **fehlender** Key heißt „keine Vorgabe/keine
 * Ausnahme für diesen Key" — NICHT `0`. Siehe `computeEntitlements`.
 */
export type EntitlementBundle = {
  limits: Partial<Record<EntitlementLimitKey, number>>;
  features: EntitlementFeatures;
};

/** Leeres Bundle — „keine Vorgabe, keine Ausnahme". */
export const EMPTY_BUNDLE: EntitlementBundle = { limits: {}, features: {} };

/** Rohdaten für die reine Berechnung (alles bereits geladen, kein DB-Zugriff). */
export type EntitlementInputs = {
  /** `businesses.tier` — nur der Paket-NAME (E9), `null` = kein Paket zugeordnet. */
  tier: string | null;
  /**
   * Die zum Tier gehörende Zeile aus `tier_definitions`, in Bundle-Form.
   * `null` = **keine passende Zeile gefunden** ⇒ Fail-safe (restriktivste
   * Werte), ausdrücklich KEIN Fehler.
   */
  tierBundle: EntitlementBundle | null;
  /** `businesses.entitlement_overrides` in Bundle-Form (leer = keine Ausnahme). */
  overrides: EntitlementBundle;
  /**
   * Die normalisierten Betriebs-Einstellungen (`businesses.settings`, unterste
   * Schicht). Bereits durch `normalizeSettings` geklemmt — hier nur gelesen.
   */
  settings: BusinessSettings;
};

/** Das Ergebnis: die effektiven Rechte eines Betriebs. */
export type Entitlements = {
  /** Der Paket-Name, aus dem gerechnet wurde (`null` = keiner zugeordnet). */
  tier: string | null;
  /** Effektives Limit je Key — immer **alle** Keys, immer eine konkrete Zahl. */
  limits: Record<EntitlementLimitKey, number>;
  /** Effektive Feature-Flags (Vereinigung aus Tier + Ausnahme). */
  features: EntitlementFeatures;
  /**
   * `true`, wenn mangels Tier bzw. Tier-Definition die **restriktivsten** Werte
   * gelten (alle Limits 0, keine Features). Rein informativ — fürs Logging und
   * für eine spätere, verständliche Fehlermeldung im UI.
   */
  fallbackApplied: boolean;
};

/**
 * Effektives Limit lesen. Reiner Zugriff auf ein bereits berechnetes Ergebnis —
 * die Formel steckt in `computeEntitlements`.
 */
export function limitFor(
  entitlements: Entitlements,
  key: EntitlementLimitKey,
): number {
  return entitlements.limits[key];
}

/**
 * Ist ein Feature freigeschaltet? **Deny-by-default**: unbekannter Key ⇒
 * `false`. Der Key ist absichtlich ein freier String (E9, siehe
 * `EntitlementFeatures`).
 */
export function hasFeature(entitlements: Entitlements, key: string): boolean {
  return entitlements.features[key] === true;
}

/**
 * jsonb → `EntitlementBundle`. Tolerant statt streng: die Werte werden von Hand
 * bzw. später im Backoffice (A4) gepflegt — ein einzelner unbrauchbarer Eintrag
 * darf nicht die gesamte Rechte-Auskunft kippen. Verworfen wird still:
 * - unbekannte Limit-Keys (kein Platz in der geschlossenen Menge, keine
 *   Plattform-Obergrenze ⇒ nicht durchsetzbar),
 * - nicht-endliche, negative oder nicht-numerische Limit-Werte,
 * - nicht-boolesche Feature-Werte.
 *
 * Ein verworfener Limit-Eintrag verhält sich wie ein **fehlender** (siehe
 * `computeEntitlements`) — nie wie `0`; „kaputte Daten" darf niemanden
 * aussperren, das ist der Job des Fail-safe-Pfads (kein Tier), nicht einzelner
 * Tippfehler.
 */
export function parseEntitlementBundle(raw: unknown): EntitlementBundle {
  const root = asRecord(raw);
  const rawLimits = asRecord(root.limits);
  const rawFeatures = asRecord(root.features);

  const limits: Partial<Record<EntitlementLimitKey, number>> = {};
  for (const key of ENTITLEMENT_LIMIT_KEYS) {
    const value = rawLimits[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      limits[key] = Math.round(value);
    }
  }

  const features: EntitlementFeatures = {};
  for (const [key, value] of Object.entries(rawFeatures)) {
    if (typeof value === "boolean") features[key] = value;
  }

  return { limits, features };
}

/**
 * Die beiden `tier_definitions`-Spalten in die gemeinsame Bundle-Form bringen,
 * damit `parseEntitlementBundle` (und damit dieselbe Merge-Logik) auch darauf
 * passt.
 */
export function bundleFromTierRow(
  limits: unknown,
  features: unknown,
): EntitlementBundle {
  return parseEntitlementBundle({ limits, features });
}
