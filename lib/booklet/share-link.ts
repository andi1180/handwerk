import { CUSTOMER_VIEW_QUERY } from "./customer-view";

/**
 * Baut den zu TEILENDEN/VERSENDENDEN Booklet-Link (Block C — Kurzlink). Die
 * EINZIGE Quelle dafür, welcher Link den Kunden erreicht bzw. geteilt wird.
 *
 * - `shortCode` vorhanden → kurzer `${base}/s/<code>` (serverseitiger Redirect
 *   aufs echte Booklet, app/s/[code]/page.tsx).
 * - sonst Fallback auf den langen `${base}/b/<token>` (alte Booklets ohne Code,
 *   die vor Migration 0008 generiert wurden — kein Backfill nötig).
 *
 * `customerView` steuert den §9d-Marker `c=1`:
 *  - true  → ausgelieferter Kunden-Link (E-Mail/QR): volle Teilen-Sicht.
 *  - false → vom Kunden GETEILTER Link (Share-Bar): nackt → Empfänger-Sicht ohne
 *    Teilen-/Bewertungs-Sektion (§9d/§8.6). Der Redirect reicht den Marker durch:
 *    ein nackter Kurzlink bleibt nackt, `?c=1` bleibt Kunden-Sicht.
 *
 * `base` ist die bereits aufgelöste Basis-URL (BOOKLET_BASE_URL oder Request-
 * Origin) — der Aufrufer bestimmt sie wie gehabt, dieser Helfer baut nur den Pfad.
 * Plain-Modul (kein service_role/Secret): server-seitig überall importierbar.
 */
export function bookletShareLink({
  base,
  accessToken,
  shortCode,
  customerView,
}: {
  base: string;
  accessToken: string;
  shortCode: string | null;
  customerView: boolean;
}): string {
  const path = shortCode ? `/s/${shortCode}` : `/b/${accessToken}`;
  const marker = customerView ? `?${CUSTOMER_VIEW_QUERY}` : "";
  return `${base}${path}${marker}`;
}
