"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/** Kopier-Icon (zwei überlappende Rechtecke). */
function CopyIcon() {
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
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/**
 * Dezenter Icon-Button: dupliziert einen Auftrag als leeres Template
 * (Kundendaten + Kontext, KEINE Medien) — für mehrere valooro-Aufträge zu
 * einem roapp-Auftrag.
 *
 * Geometrie/Optik erbt `.archive-toggle` (Muster wie `<ArchiveToggle>` /
 * `<PurgeMediaButton>`). Stoppt die Klick-Propagation, damit der umschließende
 * `<Link>` der Kachel nicht navigiert — nach dem Anlegen bleibt man in der
 * Liste, `router.refresh()` holt die neue Kachel (sie erscheint direkt über dem
 * Original).
 */
export function OrderCopyButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/orders/${orderId}/copy`, {
        method: "POST",
      });
      if (res.ok) {
        router.refresh();
      } else {
        console.error("[order-copy-button] request failed", res.status);
        window.alert(t(DEFAULT_LOCALE, "orders.copyError"));
      }
    } catch (err) {
      console.error("[order-copy-button] network error", err);
      window.alert(t(DEFAULT_LOCALE, "orders.copyError"));
    } finally {
      setBusy(false);
    }
  }

  const label = t(DEFAULT_LOCALE, "orders.copy");

  return (
    <button
      type="button"
      className="archive-toggle"
      onClick={handleClick}
      disabled={busy}
      aria-label={label}
      title={label}
    >
      <CopyIcon />
    </button>
  );
}
