import Link from "next/link";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import {
  QUICK_FILTERS,
  buildOrdersUrl,
  type QuickFilter,
} from "@/lib/orders/filters";

/**
 * Drei Schnellfilter-Buttons über der Auftragsliste (Block C / Schritt 3).
 * Server-Component-fähig: jeder Button ist ein `<Link>` — kein Client-State,
 * keine `<form>`.
 *
 * Verhalten (URL trägt den Zustand):
 *  - Klick auf einen inaktiven Quick → `?quick=<key>` (Status-Dropdown fällt
 *    damit automatisch auf „Alle" zurück, weil die URL kein `?status=` führt).
 *  - Klick auf den **aktiven** Quick → nackte Liste (`/portal/orders`),
 *    Filter aus (Toggle).
 *  - Beim Filterwechsel entfällt `?page=` ⇒ zurück auf Seite 1.
 *
 * Genau EIN Quick kann aktiv sein (`active`); ist ein Status-Dropdown-Wert
 * aktiv, ist `active === null` und kein Button hervorgehoben.
 */
const LABEL_KEY: Record<
  QuickFilter,
  "quickFlagged" | "quickDrafts" | "quickUngenerated"
> = {
  flagged: "quickFlagged",
  drafts: "quickDrafts",
  ungenerated: "quickUngenerated",
};

export function OrderQuickFilters({ active }: { active: QuickFilter | null }) {
  return (
    <div
      className="quick-filters"
      role="group"
      aria-label={t(DEFAULT_LOCALE, "orders.quickLabel")}
    >
      {QUICK_FILTERS.map((key) => {
        const isActive = active === key;
        return (
          <Link
            key={key}
            href={
              // buildOrdersUrl als EINE URL-Quelle: aktiver Quick ⇒ nackte Liste
              // (Toggle aus), sonst ?quick=<key> (droppt ?status=). Filterwechsel
              // lässt ?page= weg ⇒ zurück auf Seite 1.
              isActive ? buildOrdersUrl({}) : buildOrdersUrl({ quick: key })
            }
            className="quick-filter"
            data-active={isActive}
            aria-current={isActive ? "true" : undefined}
          >
            {t(DEFAULT_LOCALE, `orders.${LABEL_KEY[key]}`)}
          </Link>
        );
      })}
    </div>
  );
}
