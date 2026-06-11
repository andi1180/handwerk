/**
 * URL-Marker für die Kunden-Sicht der öffentlichen Web-Story (Schritt 9d).
 *
 * WICHTIG: KEIN Sicherheits-Gate. Der `access_token` bleibt der alleinige
 * Zugriffsschutz (§14.2); dieser Marker schaltet AUSSCHLIESSLICH UI (die
 * Teilen-Sektion + Review + IG-Caption). Kein DB-Zugriff hängt daran.
 *
 * - Markierter Link (`/b/[token]?c=1`) → Kunde, der den Link ausgeliefert
 *   bekam: volle Teilen-Sektion (Reel/Story/WhatsApp/Link + IG-Caption +
 *   Google-Bewertung).
 * - Nackter Link (`/b/[token]`)        → Empfänger einer geteilten Story:
 *   normales Settings-Outro, KEINE Teilen-Schicht.
 *
 * Die Share-Aktionen teilen IMMER die NACKTE URL → jeder Empfänger landet
 * automatisch in der Empfänger-Sicht.
 */
export const CUSTOMER_VIEW_PARAM = "c";
export const CUSTOMER_VIEW_VALUE = "1";

/** Query-String für markierte (Kunden-)Links, z. B. an den Vorschau-Link gehängt. */
export const CUSTOMER_VIEW_QUERY = `${CUSTOMER_VIEW_PARAM}=${CUSTOMER_VIEW_VALUE}`;

/** True, wenn der Marker (`c=1`) in den searchParams steht. */
export function isCustomerViewParam(
  searchParams: Record<string, string | string[] | undefined>,
): boolean {
  const value = searchParams[CUSTOMER_VIEW_PARAM];
  return Array.isArray(value)
    ? value.includes(CUSTOMER_VIEW_VALUE)
    : value === CUSTOMER_VIEW_VALUE;
}
