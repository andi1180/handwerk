"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import { buildOrdersUrl } from "@/lib/orders/filters";

/** Debounce für die getippte Suche → server-seitige Navigation. */
const DEBOUNCE_MS = 300;

/**
 * Suchleiste der Auftragsliste (Schritt B). Client-Insel über der
 * server-gerenderten Liste: ein einzelnes Textfeld (KEIN `<form>`), das per
 * debounced `router.push` server-seitig sucht (über `?q=`).
 *
 * Der Input hält EIGENEN lokalen State (init aus `initialQ`) und synct NICHT bei
 * jedem Re-Render aus der URL — sonst sprängen Fokus/Cursor beim Tippen. Suchen
 * setzt bewusst KEIN status/quick ⇒ überschreibt die aktive Filter-Auswahl
 * (Suche ist ein Override). Der Begriff wird beim Navigieren getrimmt; leer ⇒
 * kein Filter (nackte URL). Es wird KEIN `page`-Param mitgegeben ⇒ Reset auf
 * Seite 1. Die eigentliche Injection-Absicherung sitzt server-seitig in
 * `buildFilteredOrdersQuery`.
 */
export function OrderSearchBar({
  initialQ,
  archived,
}: {
  initialQ: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialQ);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Laufenden Debounce-Timer beim Unmount abräumen.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function pushQuery(next: string) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      router.push(buildOrdersUrl({ q: next.trim() || null, archived }));
    }, DEBOUNCE_MS);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setValue(next); // sofort — flüssiges Tippen (eigener State, kein URL-Sync)
    pushQuery(next);
  }

  function handleClear() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setValue("");
    router.push(buildOrdersUrl({ archived }));
  }

  return (
    <div className="order-search-bar">
      <input
        type="text"
        className="order-search-input"
        value={value}
        onChange={handleChange}
        placeholder={t(DEFAULT_LOCALE, "orders.searchPlaceholder")}
        aria-label={t(DEFAULT_LOCALE, "orders.searchPlaceholder")}
      />
      {value ? (
        <button
          type="button"
          className="order-search-clear"
          onClick={handleClear}
          aria-label={t(DEFAULT_LOCALE, "orders.searchClear")}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
