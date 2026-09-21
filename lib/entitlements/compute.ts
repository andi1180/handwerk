/**
 * Die **reine** Entitlement-Berechnung (Arbeitspaket A2).
 *
 * Nimmt ausschließlich bereits geladene Rohdaten entgegen — kein DB-Zugriff,
 * kein `async`, keine Server-Imports. Das Laden macht `load.ts`; diese Trennung
 * hält die Formel ohne Datenbank prüfbar.
 *
 * NOCH KEIN AUFRUFER (Verdrahtung = A7).
 */
import {
  ENTITLEMENT_LIMIT_KEYS,
  PLATFORM_CEILINGS,
  type EntitlementFeatures,
  type EntitlementInputs,
  type EntitlementLimitKey,
  type Entitlements,
} from "@/lib/entitlements/model";
import type { BusinessSettings } from "@/lib/auth/current-business";

/**
 * Betriebs-Einstellung je Limit-Key = **unterste** Schicht der Formel.
 *
 * Bewusst explizit ausgeschrieben statt per Cast über gleichnamige Keys: die
 * Übereinstimmung der Namen ist eine Absicht, kein Automatismus, und ein neuer
 * Limit-Key soll hier einen Compile-Fehler erzeugen, bis seine Quelle in
 * `businesses.settings` benannt ist.
 */
function settingLimits(
  settings: BusinessSettings,
): Record<EntitlementLimitKey, number> {
  return {
    photo_max_count: settings.photo_max_count,
    video_max_count: settings.video_max_count,
    video_max_seconds: settings.video_max_seconds,
  };
}

/**
 * Die **gewährte** Schicht: `max(Tier-Vorgabe, Betriebs-Ausnahme)`.
 *
 * Fehlen beide, gibt es keine gewährte Schicht (`undefined`) — das ist etwas
 * anderes als `0`: die Formel lässt den Term dann einfach weg und fällt auf
 * `min(Plattform-Obergrenze, Betriebs-Einstellung)` zurück (= heutiges
 * Verhalten, solange die Tiers leer sind). Fehlt nur einer der beiden, gilt der
 * vorhandene.
 *
 * Folge aus dem `max`: eine Betriebs-Ausnahme kann nur **gewähren**, nie
 * entziehen (ROLLOUT_PFLICHTENHEFT.md §4.1 — die Ausnahme liegt ÜBER der
 * Tier-Vorgabe). Weniger geben heißt: Tier ändern.
 */
function grantedLimit(
  tierValue: number | undefined,
  overrideValue: number | undefined,
): number | undefined {
  if (tierValue === undefined) return overrideValue;
  if (overrideValue === undefined) return tierValue;
  return Math.max(tierValue, overrideValue);
}

/**
 * **Effektiv(key) = min( Plattform-Obergrenze , max( Tier-Vorgabe ,
 * Betriebs-Ausnahme ) , Betriebs-Einstellung )** — ROLLOUT_PFLICHTENHEFT.md
 * §4.1, wörtlich.
 *
 * Das äußere `min()` ist die harte Kappung (E6): eine Ausnahme oberhalb der
 * Plattform-Obergrenze bleibt wirkungslos, die Obergrenze gewinnt immer.
 */
function effectiveLimit(
  key: EntitlementLimitKey,
  tier: Partial<Record<EntitlementLimitKey, number>>,
  overrides: Partial<Record<EntitlementLimitKey, number>>,
  settings: Record<EntitlementLimitKey, number>,
): number {
  const granted = grantedLimit(tier[key], overrides[key]);
  const platform = PLATFORM_CEILINGS[key];
  const setting = settings[key];

  const effective =
    granted === undefined
      ? Math.min(platform, setting)
      : Math.min(platform, granted, setting);

  // Nie negativ (Parser lässt negative Werte gar nicht erst durch; hier als
  // letzte Absicherung, damit ein Limit immer eine sinnvolle Zahl ist).
  return Math.max(0, effective);
}

/**
 * Feature-Vereinigung: `Tier-Vorgabe ODER Betriebs-Ausnahme`. Das ist das `max`
 * der Formel, auf Booleans übertragen — eine Ausnahme schaltet frei, entzieht
 * aber nie (siehe `grantedLimit`).
 *
 * Für Features gibt es bewusst **keine** Plattform-Obergrenze und keine
 * Betriebs-Einstellung: beide Schichten existieren im heutigen Datenmodell
 * nicht (in `businesses.settings` steht kein Feature-Schalter, den dieses Modul
 * kennen dürfte — `connector_roapp_enabled` ist ein UX-Schalter und gehört zu
 * C1f/B3, nicht hierher).
 */
function mergeFeatures(
  tier: EntitlementFeatures,
  overrides: EntitlementFeatures,
): EntitlementFeatures {
  const merged: EntitlementFeatures = {};
  for (const key of new Set([
    ...Object.keys(tier),
    ...Object.keys(overrides),
  ])) {
    merged[key] = tier[key] === true || overrides[key] === true;
  }
  return merged;
}

/**
 * Das restriktivste mögliche Ergebnis: alle Limits `0`, keine Features.
 *
 * Bewusst explizit ausgeschrieben (nicht per Schleife) — dieselbe Begründung
 * wie bei `PLATFORM_CEILINGS`: ein neuer Limit-Key muss hier sichtbar
 * mitentschieden werden.
 */
function lockedLimits(): Record<EntitlementLimitKey, number> {
  return { photo_max_count: 0, video_max_count: 0, video_max_seconds: 0 };
}

/**
 * Berechnet die effektiven Rechte eines Betriebs (rein, synchron).
 *
 * **Fail-safe, kein Fehler:** ist `tier` `null` oder wurde keine passende
 * `tier_definitions`-Zeile gefunden (`tierBundle === null`), gelten die
 * restriktivsten Werte — alle Limits `0`, keine Features, `fallbackApplied`.
 * Ein echter **Datenbankfehler** ist ein anderer Fall und wirft (siehe
 * `load.ts`); er darf nicht als „Betrieb hat halt nichts" durchgehen.
 *
 * **Fehlender Key ≠ 0:** fehlt ein Limit-Key in der Tier-Vorgabe UND in der
 * Ausnahme, greift nur `min(Plattform-Obergrenze, Betriebs-Einstellung)`.
 * Solange `tier_definitions` Platzhalter (leer) enthält, ist das Ergebnis
 * deshalb exakt das heutige Verhalten — dieser Schritt ändert nichts.
 *
 * **Nicht enthalten (bewusst):** `subscription_status`
 * (trial/trial_ended/past_due/canceled) und `businesses.status`
 * (pending/active/suspended) spielen hier keine Rolle. Ob ein Betrieb wegen
 * seines Abo-Zustands nur noch lesen darf, ist eine eigene Frage und ein
 * eigener, späterer Schritt.
 */
export function computeEntitlements(input: EntitlementInputs): Entitlements {
  const { tier, tierBundle, overrides, settings } = input;

  if (tier === null || tierBundle === null) {
    return {
      tier,
      limits: lockedLimits(),
      features: {},
      fallbackApplied: true,
    };
  }

  const fromSettings = settingLimits(settings);
  const limits: Record<EntitlementLimitKey, number> = {
    photo_max_count: effectiveLimit(
      "photo_max_count",
      tierBundle.limits,
      overrides.limits,
      fromSettings,
    ),
    video_max_count: effectiveLimit(
      "video_max_count",
      tierBundle.limits,
      overrides.limits,
      fromSettings,
    ),
    video_max_seconds: effectiveLimit(
      "video_max_seconds",
      tierBundle.limits,
      overrides.limits,
      fromSettings,
    ),
  };

  return {
    tier,
    limits,
    features: mergeFeatures(tierBundle.features, overrides.features),
    fallbackApplied: false,
  };
}

/** Re-Export, damit Aufrufer die Key-Liste nicht aus zwei Modulen ziehen müssen. */
export { ENTITLEMENT_LIMIT_KEYS };
