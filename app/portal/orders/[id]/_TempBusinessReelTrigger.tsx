"use client";

import { useEffect, useRef, useState } from "react";

// TEMP — Schritt 2b Test-Trigger. Wird in Schritt 3 durch den echten
// Per-Kachel-Button ersetzt.

type ReelState = "idle" | "starting" | "rendering" | "ready" | "failed";

export function TempBusinessReelTrigger({ orderId }: { orderId: string }) {
  const [state, setState] = useState<ReelState>("idle");
  const [reelUrl, setReelUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function startPoll() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/portal/orders/${orderId}/business-reel-status`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as { status: string; url?: string };
        if (cancelledRef.current) return;
        if (json.status === "ready") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setReelUrl(json.url ?? null);
          setState("ready");
        } else if (json.status === "failed") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setState("failed");
          setErrorMsg("Render fehlgeschlagen."); // TEMP
        }
        // pending/rendering → weiter pollen
      } catch {
        // Netzwerkfehler → weiter pollen
      }
    }, 3000);
  }

  async function handleClick() {
    setState("starting");
    setErrorMsg(null);
    setReelUrl(null);
    try {
      const res = await fetch(
        `/api/portal/orders/${orderId}/render-business-reel`,
        { method: "POST" },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setState("failed");
        setErrorMsg(
          `Fehler: ${json.error ?? res.status}`, // TEMP
        );
        return;
      }
      // 202 → Render läuft
      setState("rendering");
      startPoll();
    } catch {
      setState("failed");
      setErrorMsg("Netzwerkfehler."); // TEMP
    }
  }

  return (
    <div
      style={{
        marginTop: 24,
        padding: 16,
        border: "2px dashed #C4A95B",
        borderRadius: 8,
        background: "rgba(196,169,91,0.07)",
      }}
    >
      {/* TEMP label */}
      <p
        style={{ fontSize: 11, color: "#888", margin: "0 0 10px" }}
      >
        [TEMP Schritt 2b — Betriebs-Reel Test-Trigger]
      </p>

      {state === "idle" && (
        <button
          className="btn-dark"
          onClick={handleClick}
          style={{ width: "100%" }}
        >
          Betriebs-Reel erstellen (Test) {/* TEMP */}
        </button>
      )}

      {state === "starting" && (
        <p style={{ color: "#888", fontSize: 14 }}>Starte…</p> // TEMP
      )}

      {state === "rendering" && (
        <p style={{ color: "#888", fontSize: 14 }}>
          Wird gerendert… {/* TEMP */}
        </p>
      )}

      {state === "ready" && reelUrl && (
        <div>
          <p style={{ color: "green", fontSize: 14, margin: "0 0 8px" }}>
            Betriebs-Reel fertig! {/* TEMP */}
          </p>
          <a
            href={reelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline"
            style={{ display: "inline-block" }}
          >
            Betriebs-Reel öffnen {/* TEMP */}
          </a>
          <button
            className="btn-dark"
            onClick={handleClick}
            style={{ marginTop: 8, width: "100%" }}
          >
            Erneut erstellen {/* TEMP */}
          </button>
        </div>
      )}

      {state === "failed" && (
        <div>
          {errorMsg && (
            <p style={{ color: "red", fontSize: 14, margin: "0 0 8px" }}>
              {errorMsg}
            </p>
          )}
          <button
            className="btn-dark"
            onClick={handleClick}
            style={{ width: "100%" }}
          >
            Erneut versuchen {/* TEMP */}
          </button>
        </div>
      )}
    </div>
  );
}
