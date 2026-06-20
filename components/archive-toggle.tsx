"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/** Archiv-Box-Icon (Ordner mit Pfeil nach unten). */
function ArchiveIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12l2 2 2-2" />
      <path d="M12 12v4" />
    </svg>
  );
}

/** Restore-Icon (Archiv-Box mit Pfeil nach oben). */
function UnarchiveIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 16l2-2 2 2" />
      <path d="M12 14v-4" />
    </svg>
  );
}

/**
 * Dezenter Icon-Button zum Archivieren/Entarchivieren eines Auftrags.
 *
 * Positioniert sich in der rechten Spalte der Auftragskachel (unter dem Datum).
 * Stoppt die Klick-Propagation damit der übergeordnete `<Link>` nicht navigiert.
 *
 * `mode="archive"`   → zeigt das Archiv-Icon (nur auf archivierbaren Aufträgen).
 * `mode="unarchive"` → zeigt das Restore-Icon (immer im Archiv-Scope).
 */
export function ArchiveToggle({
  orderId,
  mode,
}: {
  orderId: string;
  mode: "archive" | "unarchive";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/orders/${orderId}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archive: mode === "archive" }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        console.error("[archive-toggle] request failed", res.status);
      }
    } catch (err) {
      console.error("[archive-toggle] network error", err);
    } finally {
      setBusy(false);
    }
  }

  const label = t(
    DEFAULT_LOCALE,
    mode === "archive" ? "orders.archive" : "orders.unarchive",
  );

  return (
    <button
      type="button"
      className="archive-toggle"
      onClick={handleClick}
      disabled={busy}
      aria-label={label}
      title={label}
    >
      {mode === "archive" ? <ArchiveIcon /> : <UnarchiveIcon />}
    </button>
  );
}
