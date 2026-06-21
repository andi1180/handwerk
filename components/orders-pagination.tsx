import Link from "next/link";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import {
  buildOrdersUrl,
  type QuickFilter,
  type StatusFilter,
} from "@/lib/orders/filters";

/**
 * Seiten-Navigation der Auftragsliste (Block C / Schritt 3). Server-seitige
 * Pagination ⇒ „Zurück"/„Weiter" sind `<Link>`s (kein Client-State), die den
 * **aktiven Filter** (Status-Dropdown ODER Quick) über `buildOrdersUrl`
 * mitführen. Bei nur einer Seite wird nichts gerendert.
 */
export function OrdersPagination({
  page,
  totalPages,
  status,
  quick,
  archived,
  q,
}: {
  page: number;
  totalPages: number;
  status: StatusFilter | null;
  quick: QuickFilter | null;
  archived?: boolean;
  q?: string | null;
}) {
  if (totalPages <= 1) return null;

  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;

  return (
    <nav
      className="orders-pagination"
      aria-label={t(DEFAULT_LOCALE, "orders.pagination")}
    >
      {prevDisabled ? (
        <span className="orders-page-btn" data-disabled="true" aria-disabled="true">
          {t(DEFAULT_LOCALE, "orders.prevPage")}
        </span>
      ) : (
        <Link
          className="orders-page-btn"
          href={buildOrdersUrl({ status, quick, archived, q, page: page - 1 })}
          rel="prev"
        >
          {t(DEFAULT_LOCALE, "orders.prevPage")}
        </Link>
      )}

      <span className="orders-page-info">
        {t(DEFAULT_LOCALE, "orders.pageOf", { page, total: totalPages })}
      </span>

      {nextDisabled ? (
        <span className="orders-page-btn" data-disabled="true" aria-disabled="true">
          {t(DEFAULT_LOCALE, "orders.nextPage")}
        </span>
      ) : (
        <Link
          className="orders-page-btn"
          href={buildOrdersUrl({ status, quick, archived, q, page: page + 1 })}
          rel="next"
        >
          {t(DEFAULT_LOCALE, "orders.nextPage")}
        </Link>
      )}
    </nav>
  );
}
