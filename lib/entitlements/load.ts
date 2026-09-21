/**
 * Der dünne Lade-Wrapper um die reine Berechnung (Arbeitspaket A2).
 *
 * Lädt die Rohdaten und reicht sie an `computeEntitlements` weiter — mehr
 * passiert hier nicht. Die Formel steht ausschließlich in `compute.ts`.
 *
 * NOCH KEIN AUFRUFER (Verdrahtung = A7).
 */
import type { createClient } from "@/lib/supabase/server";
import { normalizeSettings } from "@/lib/auth/current-business";
import { computeEntitlements } from "@/lib/entitlements/compute";
import {
  EMPTY_BUNDLE,
  bundleFromTierRow,
  parseEntitlementBundle,
  type EntitlementBundle,
  type Entitlements,
} from "@/lib/entitlements/model";

/**
 * Authentifizierter Server-Supabase-Client (RLS-erzwungen, KEIN service_role) —
 * dasselbe Muster wie `lib/orders/orders-query.ts` / `lib/analytics/reach.ts`.
 *
 * **Vertrag mit dem Aufrufer (Isolationsregel §14.2):** dieses Modul erzeugt
 * selbst KEINEN Client und liest NIE aus Cookies/Session. Client UND
 * `businessId` kommen von außen; `businessId` MUSS beim Aufrufer aus der
 * Session stammen, nie aus Body/Query/Payload. RLS ist die zweite Absicherung
 * darunter — deshalb ausdrücklich der authentifizierte Client, nicht
 * `service_role`.
 */
type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Die drei Felder, die für die Rechte-Auskunft aus `businesses` nötig sind. */
type BusinessEntitlementRow = {
  tier: string | null;
  entitlement_overrides: unknown;
  settings: unknown;
};

/** Die Tier-Zeile aus `tier_definitions` (Inhalte als Daten, E9). */
type TierDefinitionRow = {
  limits: unknown;
  features: unknown;
};

/**
 * Fehler beim **Laden** der Rechte-Grundlagen — ein echter Infrastruktur-/
 * Datenbankfehler, ausdrücklich NICHT „der Betrieb hat keine Rechte".
 *
 * Bewusst werfend (ROLLOUT_PFLICHTENHEFT.md §4.1: die DB ist die
 * Durchsetzungswahrheit): ein nicht erreichbarer Rechte-Datensatz darf nicht
 * still zu „alles erlaubt" und auch nicht unbemerkt zu „nichts erlaubt" werden.
 * Der spätere Aufrufer (A7) entscheidet, wie er den Fehler behandelt —
 * unbehandelt schlägt die Schreiboperation fehl, was die sichere Richtung ist.
 */
export class EntitlementsLoadError extends Error {
  constructor(step: string, message: string) {
    super(`entitlements: ${step}: ${message}`);
    this.name = "EntitlementsLoadError";
  }
}

/**
 * Lädt die effektiven Rechte eines Betriebs.
 *
 * Zwei Queries, bewusst nacheinander: erst der Betrieb (liefert den Tier-NAMEN),
 * dann — nur falls ein Tier gesetzt ist — dessen Definition. Zwischen
 * `businesses` und `tier_definitions` besteht absichtlich kein Fremdschlüssel
 * (siehe Migration 0021), ein PostgREST-Embed ist daher nicht möglich; ohne
 * Tier entfällt der zweite Roundtrip ganz.
 *
 * Verhalten:
 * - Betrieb nicht gefunden (fremde/gelöschte id, von RLS gefiltert) ⇒
 *   `fallbackApplied` mit den restriktivsten Werten, kein Fehler.
 * - `tier` null oder keine `tier_definitions`-Zeile ⇒ ebenso fail-safe.
 * - Query schlägt fehl ⇒ `EntitlementsLoadError`.
 *
 * ⚠️ Solange Migration 0021 nicht angewendet ist, existiert
 * `tier_definitions` nicht und der zweite Schritt wirft. Vor der Verdrahtung
 * (A7) muss die Migration also live sein.
 */
export async function loadEntitlements(
  client: ServerClient,
  businessId: string,
): Promise<Entitlements> {
  const { data: business, error: businessError } = await client
    .from("businesses")
    .select("tier, entitlement_overrides, settings")
    .eq("id", businessId)
    .maybeSingle<BusinessEntitlementRow>();

  if (businessError) {
    throw new EntitlementsLoadError("load_business", businessError.message);
  }

  // Kein Betrieb sichtbar ⇒ restriktivste Werte. Die Settings sind hier
  // irrelevant (alle Limits werden 0), `normalizeSettings({})` liefert die
  // dokumentierten Defaults.
  if (!business) {
    return computeEntitlements({
      tier: null,
      tierBundle: null,
      overrides: EMPTY_BUNDLE,
      settings: normalizeSettings({}),
    });
  }

  const overrides = parseEntitlementBundle(business.entitlement_overrides);
  // Eine Quelle für die Normalisierung der Betriebs-Einstellungen — dieselbe
  // Funktion, die `getCurrentBusiness` und der öffentliche Booklet-Render
  // nutzen. Sie klemmt bereits auf die Plattform-Obergrenzen; die Formel
  // wendet `min()` trotzdem erneut an (die Kappung darf nicht davon abhängen,
  // dass eine andere Schicht sie schon gemacht hat).
  const settings = normalizeSettings(business.settings);

  let tierBundle: EntitlementBundle | null = null;
  if (business.tier !== null) {
    const { data: definition, error: definitionError } = await client
      .from("tier_definitions")
      .select("limits, features")
      .eq("tier", business.tier)
      .maybeSingle<TierDefinitionRow>();

    if (definitionError) {
      throw new EntitlementsLoadError(
        "load_tier_definition",
        definitionError.message,
      );
    }

    // Keine Zeile ⇒ `tierBundle` bleibt null ⇒ fail-safe in der Berechnung.
    if (definition) {
      tierBundle = bundleFromTierRow(definition.limits, definition.features);
    }
  }

  return computeEntitlements({
    tier: business.tier,
    tierBundle,
    overrides,
    settings,
  });
}
