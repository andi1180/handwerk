"use client";

import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import { ORDER_STATUSES, type OrderStatus } from "./order-status-badge";

/**
 * Status-Filter über der Auftragsliste (Block B, Punkt 5). Ein einfaches
 * `<select>` (EINE Auswahl): „Alle" (Default) + alle Auftrags-Status aus
 * `ORDER_STATUSES`. Die Liste lädt server-seitig (Server Component), daher
 * navigiert die Auswahl per Query-Param `?status=` — der Server filtert dann.
 * Kein `<form>`: reine Navigation per `onChange`.
 */
export function OrderStatusFilter({ value }: { value: OrderStatus | "all" }) {
  const router = useRouter();
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
        value={value}
        aria-label={t(DEFAULT_LOCALE, "orders.filterLabel")}
        onChange={(e) => {
          const next = e.target.value;
          router.push(
            next === "all"
              ? "/portal/orders"
              : `/portal/orders?status=${next}`,
          );
        }}
        style={{ width: "auto", minWidth: 150 }}
      >
        <option value="all">{t(DEFAULT_LOCALE, "orders.filterAll")}</option>
        {ORDER_STATUSES.map((status) => (
          <option key={status} value={status}>
            {t(DEFAULT_LOCALE, `orderStatus.${status}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
