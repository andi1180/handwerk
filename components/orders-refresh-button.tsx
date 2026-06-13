"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/**
 * Dezenter Refresh-Button für die Auftragsliste (Punkt 4). Lädt die
 * Server-Daten neu (`router.refresh()`), damit per Webhook frisch angelegte
 * Aufträge ohne vollen Reload auftauchen. `useTransition` zeigt den laufenden
 * Refresh über das rotierende Icon an; während des Übergangs ist der Button
 * deaktiviert (kein Doppel-Refresh).
 */
export function OrdersRefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="orders-refresh"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
      data-pending={pending}
      aria-label={t(DEFAULT_LOCALE, "orders.refresh")}
      title={t(DEFAULT_LOCALE, "orders.refresh")}
    >
      <svg
        width={20}
        height={20}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    </button>
  );
}
