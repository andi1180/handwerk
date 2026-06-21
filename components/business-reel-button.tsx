"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/** Render-Zustand des Betriebs-Reels — spiegelt `booklets.business_reel_status`. */
export type BusinessReelStatus = "pending" | "rendering" | "ready" | "failed";

const REEL_POLL_MS = 3_000;

/**
 * Kompaktes Pill auf einer Auftragskachel, das den Render-Zustand des
 * Betriebs-Reels anzeigt und den Render-Start/Retry auslöst.
 *
 * Propagation-STOPPEND (wie `ArchiveToggle`) — ein Tap navigiert NICHT
 * zur Detailseite des Auftrags.
 *
 * Props:
 *  - `orderId`  — Order-ID für die Fetch-URLs.
 *  - `status`   — initialer Render-Zustand (vom Server aus `booklets.business_reel_status`).
 *  - `gateOk`   — true wenn ≥1 Vorher-Foto UND ≥1 Nachher-Foto vorhanden.
 *
 * Zustände:
 *  0 NICHT MÖGLICH  — pending + !gateOk  → grauer Disabled-Pill
 *  1 BEREIT          — pending + gateOk   → Gold-Pill, Tap = Render starten
 *  1b RENDERT        — rendering           → Amber-Pill + Spinner, kein Tap
 *  2 FERTIG          — ready              → Grün-Pill (3c macht ihn klickbar)
 *  F FEHLER          — failed             → Rot-Pill, Tap = Retry
 *
 * Kein `<form>`, kein `any`. AUTHENTICATED + RLS (Routes prüfen server-seitig).
 */
export function BusinessReelButton({
  orderId,
  status,
  gateOk,
}: {
  orderId: string;
  status: BusinessReelStatus;
  gateOk: boolean;
}) {
  const [current, setCurrent] = useState<BusinessReelStatus>(status);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
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

  // Zustand 2: Fertig — Grün, nicht klickbar (3c erweitert das).
  if (current === "ready") {
    return (
      <div
        className="business-reel-pill business-reel-pill--ready"
        onClick={stopOnly}
      >
        {t(DEFAULT_LOCALE, "businessReel.ready")}
      </div>
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
