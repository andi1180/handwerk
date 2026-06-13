import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/** Tag/Monat für „Abgeholt am TT.MM. …". */
const DATE_FORMAT = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
});

/**
 * Roter Warn-Hinweis „Abgeholt am TT.MM. – Booklet nicht versendet"
 * (Block C / Schritt 2, neu gestaltet).
 *
 * Erscheint als **Hinweiszeile über die volle Kartenbreite am unteren Rand**
 * der Auftragskarte — zusammen mit einer dezenten roten Kartenumrandung
 * (`.card-flagged`), die die Karte als „Achtung" markiert. Treiber ist
 * `orders.picked_up_at`: roapp meldete den Auftrag als „Abgeholt", obwohl bei
 * uns noch kein Booklet versendet wurde. Die Liste rendert den Hinweis NUR,
 * wenn das Flag gesetzt ist UND der Status NICHT in {sent, viewed, shared}
 * liegt (Doppel-Sicherung gegen ein theoretisch nicht zurückgesetztes Flag).
 *
 * Ersetzt den früheren überbreiten Inline-Pill, der über den rechten Kartenrand
 * lief und den Kartentext verdrängte. Diese Zeile bricht auf schmalen Viewports
 * (~380px) sauber um — kein `nowrap`, kein Abschneiden, kein Überlauf.
 *
 * Rein visuell — NICHT klickbar (die Karte selbst verlinkt zum Auftrag).
 * Reine Präsentation, Server-Component-fähig (Muster wie order-status-badge).
 */
export function PickupPendingBadge({ pickedUpAt }: { pickedUpAt: string }) {
  return (
    <div className="order-pickup-warning">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ flexShrink: 0, marginTop: 1 }}
      >
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span>
        {t(DEFAULT_LOCALE, "orderStatus.pickupPendingNotice", {
          date: DATE_FORMAT.format(new Date(pickedUpAt)),
        })}
      </span>
    </div>
  );
}
