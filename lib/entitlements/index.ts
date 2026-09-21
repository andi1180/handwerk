/**
 * `lib/entitlements` — die EINE zentrale Auskunft „darf/kann dieser Betrieb X?"
 * (Arbeitspaket A2, ROLLOUT_PFLICHTENHEFT.md §4.1).
 *
 * **Effektiv(key) = min( Plattform-Obergrenze , max( Tier-Vorgabe ,
 * Betriebs-Ausnahme ) , Betriebs-Einstellung )**
 *
 * | Schicht | Quelle | wer ändert |
 * |---|---|---|
 * | Plattform-Obergrenze | `PLATFORM_CEILINGS` (= `max` aus `lib/settings/options.ts`) | nur Andreas, Code |
 * | Tier-Vorgabe | `tier_definitions` (Migration 0021) | Daten, ohne Deploy (E9) |
 * | Betriebs-Ausnahme | `businesses.entitlement_overrides` (0019) | Daten, pro Betrieb |
 * | Betriebs-Einstellung | `businesses.settings` | der Kunde selbst |
 *
 * Gedacht für Aufrufer so:
 * ```ts
 * const entitlements = await loadEntitlements(supabase, business.id);
 * if (photoCount >= limitFor(entitlements, "photo_max_count")) …
 * if (!hasFeature(entitlements, "ai_captions")) …
 * ```
 *
 * ⚠️ **Noch KEIN Aufrufer.** Das Modul entsteht isoliert; die Durchsetzung an
 * den Schreibstellen (Upload-/Render-Route) ist Arbeitspaket A7. Bis dahin
 * ändert sich am Verhalten der App nichts.
 *
 * Nicht Aufgabe dieses Moduls: `subscription_status` und `businesses.status` —
 * siehe `computeEntitlements`.
 */
export {
  ENTITLEMENT_LIMIT_KEYS,
  EMPTY_BUNDLE,
  PLATFORM_CEILINGS,
  bundleFromTierRow,
  hasFeature,
  limitFor,
  parseEntitlementBundle,
  type EntitlementBundle,
  type EntitlementFeatures,
  type EntitlementInputs,
  type EntitlementLimitKey,
  type Entitlements,
} from "@/lib/entitlements/model";

export { computeEntitlements } from "@/lib/entitlements/compute";

export { EntitlementsLoadError, loadEntitlements } from "@/lib/entitlements/load";
