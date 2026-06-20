/**
 * Eligibility-Helfer für das Archivieren von Aufträgen.
 * EINE Quelle — wird von UI (Kachel-Gating) UND Route (Server-Guard) genutzt.
 *
 * Archivierbar = versendet (sent/viewed/shared) ODER roapp meldete „Abgeholt"
 * (picked_up_at IS NOT NULL). Entwürfe ohne Flag und generierte, noch nicht
 * versendete Aufträge sind NICHT archivierbar.
 *
 * Entarchivieren ist IMMER erlaubt — keine Eligibility-Prüfung.
 */
export function isArchivable(
  status: string,
  pickedUpAt: string | null,
): boolean {
  return (
    status === "sent" ||
    status === "viewed" ||
    status === "shared" ||
    pickedUpAt != null
  );
}
