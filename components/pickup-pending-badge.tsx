import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/** Tag/Monat für den dezenten „abgeholt am TT.MM."-Zusatz. */
const DATE_FORMAT = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
});

/**
 * Roter Warn-Badge „Abgeholt – Booklet nicht versendet" (Block C / Schritt 2).
 *
 * Erscheint auf der Auftragskachel, wenn roapp den Auftrag als „Abgeholt" meldet,
 * OBWOHL bei uns noch kein Booklet versendet wurde (Auftrag noch draft/finalized).
 * Treiber ist `orders.picked_up_at`; die Liste rendert den Badge NUR, wenn das
 * Flag gesetzt ist UND der Status NICHT in {sent, viewed, shared} liegt
 * (Doppel-Sicherung gegen ein theoretisch nicht zurückgesetztes Flag).
 *
 * Rein visuell — NICHT klickbar (der Betrieb navigiert selbst zum Auftrag).
 * Reine Präsentation, Server-Component-fähig (Muster wie order-status-badge).
 */
export function PickupPendingBadge({ pickedUpAt }: { pickedUpAt: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: "nowrap",
        background: "var(--red-light)",
        border: "1px solid var(--red-border)",
        color: "var(--red-text)",
      }}
    >
      {t(DEFAULT_LOCALE, "orderStatus.pickupPending")}
      <span style={{ fontWeight: 500, opacity: 0.75 }}>
        {t(DEFAULT_LOCALE, "orderStatus.pickupPendingDate", {
          date: DATE_FORMAT.format(new Date(pickedUpAt)),
        })}
      </span>
    </span>
  );
}
