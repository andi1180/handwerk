"use client";

import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import { buildOrdersUrl, type QuickFilter } from "@/lib/orders/filters";
import {
  ORDER_STATUSES,
  isOrderStatus,
  type OrderStatus,
} from "./order-status-badge";

/** Sentinel-Wert der deaktivierten Platzhalter-Option (kein echter Status). */
const QUICK_PLACEHOLDER = "__quick__";

/**
 * Status-Filter über der Auftragsliste (Block B, Punkt 5). Ein einfaches
 * `<select>` (EINE Auswahl): „Alle" (Default) + alle Auftrags-Status aus
 * `ORDER_STATUSES`. Die Liste lädt server-seitig (Server Component), daher
 * navigiert die Auswahl per Query-Param (`buildOrdersUrl`) — der Server filtert
 * dann. Kein `<form>`: reine Navigation per `onChange`.
 *
 * Sync mit den Quick-Filtern (FIX 2): Status (`?status=`) und Quick (`?quick=`)
 * sind getrennte, sich ausschließende Achsen. Jede Dropdown-Wahl baut eine
 * frische URL über `buildOrdersUrl` und droppt damit IMMER `?quick=`; „Alle"
 * liefert die nackte, ungefilterte Liste in EINEM Schritt.
 *
 * Damit „Alle" auch bei aktivem Quick-Filter wirklich wählbar ist, zeigt das
 * Dropdown dann eine deaktivierte Platzhalter-Option (statt „Alle" als aktiven
 * Wert) — sonst wäre „Alle" bereits ausgewählt und ein erneutes Wählen ein
 * No-op (das HTML-`<select>` feuert kein `onChange` für den schon gesetzten
 * Wert), und man käme nur umständlich zurück.
 */
export function OrderStatusFilter({
  value,
  quick,
}: {
  value: OrderStatus | "all";
  quick: QuickFilter | null;
}) {
  const router = useRouter();
  // Aktiver Quick ⇒ Platzhalter-Sentinel anzeigen (damit „Alle" wieder wählbar
  // ist); sonst der echte Status bzw. „all".
  const selectValue = value !== "all" ? value : quick ? QUICK_PLACEHOLDER : "all";
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        color: "var(--text-secondary)",
      }}
    >
      {t(DEFAULT_LOCALE, "orders.filterLabel")}
      <select
        className="form-input"
        value={selectValue}
        aria-label={t(DEFAULT_LOCALE, "orders.filterLabel")}
        onChange={(e) => {
          // isOrderStatus filtert „all" UND den Platzhalter aus ⇒ status: null
          // ⇒ buildOrdersUrl baut die nackte Liste (droppt ?status= und ?quick=).
          // Ein echter Status ⇒ ?status=X (ebenfalls ohne ?quick=).
          const next = e.target.value;
          router.push(
            buildOrdersUrl({ status: isOrderStatus(next) ? next : null }),
          );
        }}
        style={{ width: "auto", minWidth: 150 }}
      >
        <option value="all">{t(DEFAULT_LOCALE, "orders.filterAll")}</option>
        {quick ? (
          <option value={QUICK_PLACEHOLDER} disabled>
            {t(DEFAULT_LOCALE, "orders.filterQuickActive")}
          </option>
        ) : null}
        {ORDER_STATUSES.map((status) => (
          <option key={status} value={status}>
            {t(DEFAULT_LOCALE, `orderStatus.${status}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
