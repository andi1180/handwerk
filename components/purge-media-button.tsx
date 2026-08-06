"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/** Papierkorb-Icon (Medien löschen). */
function PurgeIcon() {
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
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/**
 * Icon-Button auf einer **archivierten** Auftragskachel, der die Medien des
 * Auftrags löscht (Storage + `order_media`-Zeilen) und die Reel-Status auf
 * `'purged'` setzt. Auftrag, Booklet und Analytics-Historie bleiben erhalten.
 *
 * Sichtbarkeit entscheidet der Aufrufer (Liste): nur im Archiv-Scope und nur,
 * solange nicht bereits beide Reel-Status `'purged'` sind.
 *
 * Propagation-STOPPEND (wie `ArchiveToggle`) — ein Tap navigiert NICHT zur
 * Detailseite; die Kachel ist ein `<Link>`.
 *
 * Bestätigung über ein div-basiertes Overlay im bestehenden Popup-Muster
 * (`biz-reel-backdrop` / `biz-reel-popup`, aus `BusinessReelButton`) — **kein**
 * natives `confirm()`. Das Overlay nennt den Auftrag beim Namen, damit auf der
 * Liste klar ist, welche Karte gemeint ist.
 */
export function PurgeMediaButton({
  orderId,
  orderLabel,
}: {
  orderId: string;
  orderLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  function stop(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function openDialog(e: React.MouseEvent) {
    stop(e);
    setFailed(false);
    setOpen(true);
  }

  function closeDialog(e?: React.MouseEvent) {
    if (e) stop(e);
    if (busy) return;
    setOpen(false);
  }

  async function handleConfirm(e: React.MouseEvent) {
    stop(e);
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/portal/orders/${orderId}/media/purge`, {
        method: "POST",
      });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        console.error("[purge-media] request failed", res.status);
        setFailed(true);
      }
    } catch (err) {
      console.error("[purge-media] network error", err);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const label = t(DEFAULT_LOCALE, "orders.purgeMedia");

  return (
    <>
      <button
        type="button"
        className="archive-toggle purge-media-toggle"
        onClick={openDialog}
        aria-label={label}
        title={label}
      >
        <PurgeIcon />
      </button>

      {open ? (
        <div className="biz-reel-backdrop" onClick={closeDialog}>
          <div className="biz-reel-popup purge-media-dialog" onClick={stop}>
            <button
              type="button"
              className="biz-reel-popup__close"
              onClick={closeDialog}
              aria-label={t(DEFAULT_LOCALE, "reel.close")}
            >
              ✕
            </button>

            <p className="purge-media-dialog__title">
              {t(DEFAULT_LOCALE, "orders.purgeConfirmTitle")}
            </p>
            <p className="purge-media-dialog__ref">{orderLabel}</p>
            <p className="purge-media-dialog__text">
              {t(DEFAULT_LOCALE, "orders.purgeConfirmText")}
            </p>

            {failed ? (
              <p className="biz-reel-popup__error">
                {t(DEFAULT_LOCALE, "orders.purgeError")}
              </p>
            ) : null}

            <div className="purge-media-dialog__actions">
              <button
                type="button"
                className="btn-outline"
                onClick={closeDialog}
                disabled={busy}
              >
                {t(DEFAULT_LOCALE, "orders.purgeCancel")}
              </button>
              <button
                type="button"
                className="btn-dark purge-media-dialog__danger"
                onClick={handleConfirm}
                disabled={busy}
              >
                {busy
                  ? t(DEFAULT_LOCALE, "orders.purgeBusy")
                  : t(DEFAULT_LOCALE, "orders.purgeConfirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
