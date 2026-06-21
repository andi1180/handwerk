"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import {
  canShareFiles,
  fetchAsShareFile,
  shareFile,
  downloadFile,
} from "@/lib/share/file-share";

/** Render-Zustand des Betriebs-Reels — spiegelt `booklets.business_reel_status`. */
export type BusinessReelStatus = "pending" | "rendering" | "ready" | "failed";

const REEL_POLL_MS = 3_000;

/**
 * Kompaktes Pill auf einer Auftragskachel, das den Render-Zustand des
 * Betriebs-Reels anzeigt und den Render-Start/Retry / das Teilen auslöst.
 *
 * Propagation-STOPPEND (wie `ArchiveToggle`) — ein Tap navigiert NICHT
 * zur Detailseite des Auftrags.
 *
 * Props:
 *  - `orderId`        — Order-ID für die Fetch-URLs.
 *  - `status`         — initialer Render-Zustand (aus `booklets.business_reel_status`).
 *  - `gateOk`         — true wenn ≥1 Vorher-Foto UND ≥1 Nachher-Foto vorhanden.
 *  - `initialSharedAt`— true wenn `booklets.business_reel_shared_at` IS NOT NULL.
 *
 * Zustände:
 *  0  — pending + !gateOk  → grauer Disabled-Pill
 *  1  — pending + gateOk   → Gold-Pill, Tap = Render starten
 *  1b — rendering           → Amber-Pill + Spinner, kein Tap
 *  2  — ready + !sharedAt  → Grün-Pill „Reel teilen", Tap = Popup öffnen
 *  3  — ready + sharedAt   → Grün-Pill „Erneut teilen", Tap = Popup öffnen
 *  F  — failed             → Rot-Pill, Tap = Retry
 *
 * Kein `<form>`, kein `any`. AUTHENTICATED + RLS (Routes prüfen server-seitig).
 */
export function BusinessReelButton({
  orderId,
  status,
  gateOk,
  initialSharedAt = false,
}: {
  orderId: string;
  status: BusinessReelStatus;
  gateOk: boolean;
  initialSharedAt?: boolean;
}) {
  const [current, setCurrent] = useState<BusinessReelStatus>(status);
  const [busy, setBusy] = useState(false);
  const [sharedAt, setSharedAt] = useState(initialSharedAt);

  // Teilen-Popup (Zustand 2/3).
  const [popupOpen, setPopupOpen] = useState(false);
  const [reelFile, setReelFile] = useState<File | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [canShare, setCanShare] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setCanShare(canShareFiles());
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Resume: Poll läuft sofort an, wenn der Server bereits `rendering` meldet.
  useEffect(() => {
    if (current === "rendering") startPoll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount

  function startPoll() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/portal/orders/${orderId}/business-reel-status`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as { status: string };
        if (!mountedRef.current) return;
        if (json.status === "ready" || json.status === "failed") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setCurrent(json.status as BusinessReelStatus);
        }
      } catch {
        // Netzwerkfehler → weiter pollen
      }
    }, REEL_POLL_MS);
  }

  async function handleRender(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/portal/orders/${orderId}/render-business-reel`,
        { method: "POST" },
      );
      if (!res.ok) {
        if (mountedRef.current) setCurrent("failed");
        return;
      }
      // 202 → Render läuft im Hintergrund
      if (mountedRef.current) {
        setCurrent("rendering");
        startPoll();
      }
    } catch {
      if (mountedRef.current) setCurrent("failed");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  /** Öffnet das Teilen-Popup, holt die frische Signed-URL und lädt die Datei vor. */
  async function openPopup(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Zustand für diese Öffnung zurücksetzen.
    setReelFile(null);
    setFetchError(false);
    setFetching(true);
    setPopupOpen(true);
    try {
      const statusRes = await fetch(
        `/api/portal/orders/${orderId}/business-reel-status`,
      );
      if (!statusRes.ok) throw new Error("status_failed");
      const { url } = (await statusRes.json()) as { url: string | null };
      if (!url) throw new Error("no_url");
      const file = await fetchAsShareFile(url, "business-reel.mp4", "video/mp4");
      if (mountedRef.current) setReelFile(file);
    } catch {
      if (mountedRef.current) setFetchError(true);
    } finally {
      if (mountedRef.current) setFetching(false);
    }
  }

  function closePopup(e?: React.MouseEvent) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setPopupOpen(false);
    setReelFile(null);
    setFetching(false);
    setFetchError(false);
  }

  /**
   * Teilt das Reel via Web Share API. WICHTIG: `shareFile` wird SYNCHRON
   * aufgerufen (kein await davor) — iOS transient activation bleibt erhalten.
   * POST business-reel-shared ist fire-and-forget NACH dem share-Aufruf.
   */
  function handleShare(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!reelFile) return;
    // Synchroner kick von navigator.share (kein await davor).
    void shareFile(reelFile, t(DEFAULT_LOCALE, "businessReel.shareTitle"));
    // Fire-and-forget: shared_at persistieren.
    void fetch(`/api/portal/orders/${orderId}/business-reel-shared`, {
      method: "POST",
    });
    setSharedAt(true);
    setPopupOpen(false);
    setReelFile(null);
    setFetching(false);
    setFetchError(false);
  }

  function handleDownload(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!reelFile) return;
    const blobUrl = URL.createObjectURL(reelFile);
    downloadFile(blobUrl, "business-reel.mp4");
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    closePopup();
  }

  /** Stoppt Klick-Propagation ohne eigene Aktion (für nicht-klickbare Zustände). */
  function stopOnly(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  // Zustand 0: Gate fehlt — dezenter Disabled-Pill.
  if (current === "pending" && !gateOk) {
    return (
      <div
        className="business-reel-pill business-reel-pill--disabled"
        onClick={stopOnly}
        title={t(DEFAULT_LOCALE, "businessReel.gateMissing")}
      >
        {t(DEFAULT_LOCALE, "businessReel.gateMissing")}
      </div>
    );
  }

  // Zustand 1b: Rendert — Amber + Spinner, kein Tap.
  if (current === "rendering") {
    return (
      <div
        className="business-reel-pill business-reel-pill--rendering"
        onClick={stopOnly}
      >
        <SpinnerIcon />
        {t(DEFAULT_LOCALE, "businessReel.rendering")}
      </div>
    );
  }

  // Zustand 2+3: Fertig — klickbar, öffnet Teilen-Popup.
  if (current === "ready") {
    const label = sharedAt
      ? t(DEFAULT_LOCALE, "businessReel.reshare")
      : t(DEFAULT_LOCALE, "businessReel.share");
    return (
      <>
        <button
          type="button"
          className="business-reel-pill business-reel-pill--ready"
          onClick={openPopup}
        >
          {label}
        </button>
        {popupOpen && (
          <ReelSharePopup
            fetching={fetching}
            fetchError={fetchError}
            reelFile={reelFile}
            canShare={canShare}
            onShare={handleShare}
            onDownload={handleDownload}
            onClose={closePopup}
          />
        )}
      </>
    );
  }

  // Zustand F: Fehlgeschlagen — Rot, Tap = Retry.
  if (current === "failed") {
    return (
      <button
        type="button"
        className="business-reel-pill business-reel-pill--failed"
        onClick={handleRender}
        disabled={busy}
      >
        {busy ? "…" : t(DEFAULT_LOCALE, "businessReel.retry")}
      </button>
    );
  }

  // Zustand 1: Bereit — Gold, Tap = Render starten.
  return (
    <button
      type="button"
      className="business-reel-pill business-reel-pill--create"
      onClick={handleRender}
      disabled={busy}
    >
      {busy ? "…" : t(DEFAULT_LOCALE, "businessReel.create")}
    </button>
  );
}

// ─── Popup ────────────────────────────────────────────────────────────────────

function ReelSharePopup({
  fetching,
  fetchError,
  reelFile,
  canShare,
  onShare,
  onDownload,
  onClose,
}: {
  fetching: boolean;
  fetchError: boolean;
  reelFile: File | null;
  canShare: boolean;
  onShare: (e: React.MouseEvent) => void;
  onDownload: (e: React.MouseEvent) => void;
  onClose: (e?: React.MouseEvent) => void;
}) {
  // Backdrop-Klick schließt; Klick aufs Panel selbst schließt nicht.
  function handleBackdrop(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onClose();
  }
  function handlePanel(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  return (
    <div className="biz-reel-backdrop" onClick={handleBackdrop}>
      <div className="biz-reel-popup" onClick={handlePanel}>
        {/* Schließen-X */}
        <button
          type="button"
          className="biz-reel-popup__close"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
          aria-label={t(DEFAULT_LOCALE, "reel.close")}
        >
          ✕
        </button>

        {fetching ? (
          <p className="biz-reel-popup__status">
            {t(DEFAULT_LOCALE, "businessReel.preparing")}
          </p>
        ) : fetchError ? (
          <>
            <p className="biz-reel-popup__error">
              {t(DEFAULT_LOCALE, "businessReel.loadError")}
            </p>
            <button
              type="button"
              className="btn-outline"
              style={{ fontSize: 13 }}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
            >
              {t(DEFAULT_LOCALE, "reel.close")}
            </button>
          </>
        ) : reelFile ? (
          canShare ? (
            <button
              type="button"
              className="btn-gold"
              style={{ width: "100%" }}
              onClick={onShare}
            >
              {t(DEFAULT_LOCALE, "businessReel.shareNow")}
            </button>
          ) : (
            <button
              type="button"
              className="btn-dark"
              style={{ width: "100%" }}
              onClick={onDownload}
            >
              {t(DEFAULT_LOCALE, "businessReel.download")}
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function SpinnerIcon() {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      aria-hidden
      className="business-reel-spinner"
    >
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}
