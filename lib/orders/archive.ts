/**
 * Eligibility-Helfer für das Archivieren von Aufträgen.
 * EINE Quelle — wird von UI (Kachel-Gating), Einzel-Route (Server-Guard) UND
 * Bulk-Route (Eligibility im WHERE) genutzt — kein Drift zwischen den Pfaden.
 *
 * Archivierbar = versendet (sent/viewed/shared) ODER roapp meldete „Abgeholt"
 * (picked_up_at IS NOT NULL). Entwürfe ohne Flag und generierte, noch nicht
 * versendete Aufträge sind NICHT archivierbar.
 *
 * Entarchivieren ist IMMER erlaubt — keine Eligibility-Prüfung.
 */

/** Status, die für sich allein bereits archivierbar machen (= „versendet"-Stufen). */
export const ARCHIVABLE_STATUSES = ["sent", "viewed", "shared"] as const;

export function isArchivable(
  status: string,
  pickedUpAt: string | null,
): boolean {
  return (
    (ARCHIVABLE_STATUSES as readonly string[]).includes(status) ||
    pickedUpAt != null
  );
}
