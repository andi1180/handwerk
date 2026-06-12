import type { OrderStatus } from "@/components/order-status-badge";

/**
 * Quick-Filter der Auftragsliste (Block C / Schritt 3). Eigene Achse **neben**
 * dem Status-Dropdown (`?status=`) — sie deckt Mehrfach-/Sonderbedingungen ab,
 * die kein einzelner Status-Wert ausdrückt, und läuft daher über einen eigenen
 * Query-Parameter `?quick=`. Dropdown und Quick schließen sich gegenseitig aus
 * (immer nur einer führt).
 *
 *  - `flagged`      → „Abgeholt, Booklet nicht versendet" (exakt die Warn-Badge-
 *                     Bedingung aus Block C / Schritt 2): `picked_up_at` gesetzt
 *                     UND Status ∈ {draft, finalized, generated}
 *                     (= NOT IN {sent, viewed, shared}).
 *  - `drafts`       → Status === 'draft'.
 *  - `ungenerated`  → Status ∈ {draft, finalized}.
 */
export const QUICK_FILTERS = ["flagged", "drafts", "ungenerated"] as const;

export type QuickFilter = (typeof QUICK_FILTERS)[number];

/** Typ-Guard: ist der String ein gültiger Quick-Filter? */
export function isQuickFilter(value: unknown): value is QuickFilter {
  return (
    typeof value === "string" &&
    (QUICK_FILTERS as readonly string[]).includes(value)
  );
}

/** Seitengröße der server-seitig paginierten Auftragsliste. */
export const ORDERS_PAGE_SIZE = 20;

/**
 * Baut die Auftragslisten-URL aus dem aktiven Filter + Seite. **Eine Quelle**
 * für die Pagination-Links (`OrdersPagination`) und den Overshoot-Redirect der
 * Seite. Quick hat Vorrang vor Status (sie schließen sich ohnehin aus); `page`
 * wird nur ab Seite 2 angehängt (Seite 1 = nackte URL).
 */
export function buildOrdersUrl(opts: {
  status?: OrderStatus | null;
  quick?: QuickFilter | null;
  page?: number;
}): string {
  const params = new URLSearchParams();
  if (opts.quick) params.set("quick", opts.quick);
  else if (opts.status) params.set("status", opts.status);
  if (opts.page && opts.page > 1) params.set("page", String(opts.page));
  const qs = params.toString();
  return qs ? `/portal/orders?${qs}` : "/portal/orders";
}
