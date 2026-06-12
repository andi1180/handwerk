"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/**
 * Finalize-/Reopen-Steuerung des mobilen Assemblers (6c, Layout-Umbau). Zwei
 * kleine Client-Komponenten mit geteilter Logik (`postAction` +
 * `router.refresh()`):
 *
 *  - `<FinalizeButton>` (Status `draft`): prominenter „Booklet erstellen"-
 *    Button am Seitenende (Schritt 1: schließt die Medien ab). KEIN
 *    Bestätigungsdialog — der Schritt ist per Reopen voll reversibel; ohne
 *    Medium gar kein Request, sondern direkt der Hinweis (der Server prüft
 *    zusätzlich, 6c-Route).
 *  - `<ReopenButton>` (Status `finalized`): kleiner „Bearbeiten"-Button in der
 *    Aktionszone (Reopen → zurück in den Editier-Modus).
 *
 * ISOLATION: Beide POSTen ohne Body; Betrieb/Order werden im Route Handler
 * gegen die Session geprüft.
 */

/** Gemeinsamer POST auf `finalize`/`reopen` (kein Body — Session entscheidet). */
export async function postAction(
  orderId: string,
  action: "finalize" | "reopen",
): Promise<Response> {
  return fetch(`/api/portal/orders/${orderId}/${action}`, { method: "POST" });
}

/**
 * Prominenter „Booklet erstellen"-Button (nur im Editier-Modus, Status `draft`).
 * POSTet weiterhin NUR `finalize` (kein Chaining) — der zweite Schritt
 * (generate) erscheint nach dem Refresh an derselben Stelle.
 */
export function FinalizeButton({
  orderId,
  mediaCount,
}: {
  orderId: string;
  mediaCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleFinalize = useCallback(() => {
    // Ohne Medium kein Request — direkt der Hinweis (Server prüft zusätzlich).
    if (mediaCount < 1) {
      setNotice(t(DEFAULT_LOCALE, "finalize.needMedia"));
      return;
    }

    setBusy(true);
    setNotice(null);
    void (async () => {
      try {
        const res = await postAction(orderId, "finalize");
        if (!res.ok) throw new Error("finalize_failed");
        router.refresh(); // Server rendert die Aktionszone im nächsten Schritt neu
      } catch {
        setNotice(t(DEFAULT_LOCALE, "finalize.error"));
        setBusy(false);
      }
    })();
  }, [mediaCount, orderId, router]);

  return (
    <div style={{ marginTop: 24 }}>
      <button
        type="button"
        className="btn-gold capture-btn"
        onClick={handleFinalize}
        disabled={busy}
        style={{ opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}
      >
        {t(DEFAULT_LOCALE, "finalize.button")}
      </button>

      <p style={{ marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>
        {t(DEFAULT_LOCALE, "finalize.hint")}
      </p>

      {notice ? (
        <div
          role="alert"
          className="card"
          style={{
            marginTop: 12,
            padding: 12,
            fontSize: 13,
            color: "#B23B3B",
            borderColor: "var(--border)",
          }}
        >
          {notice}
        </div>
      ) : null}
    </div>
  );
}

/** Kleiner „Bearbeiten"-Button (Reopen) für die Aktionszone (Status `finalized`). */
export function ReopenButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleReopen = useCallback(() => {
    setBusy(true);
    setNotice(null);
    void (async () => {
      try {
        const res = await postAction(orderId, "reopen");
        if (!res.ok) throw new Error("reopen_failed");
        router.refresh(); // zurück in den Editier-Modus
      } catch {
        setNotice(t(DEFAULT_LOCALE, "finalize.error"));
        setBusy(false);
      }
    })();
  }, [orderId, router]);

  return (
    <div style={{ marginTop: 12 }}>
      <button
        type="button"
        className="btn-outline"
        onClick={handleReopen}
        disabled={busy}
        style={{
          opacity: busy ? 0.6 : 1,
          cursor: busy ? "default" : "pointer",
        }}
      >
        {t(DEFAULT_LOCALE, "finalize.reopen")}
      </button>

      {notice ? (
        <div
          role="alert"
          className="card"
          style={{
            marginTop: 12,
            padding: 12,
            fontSize: 13,
            color: "#B23B3B",
            borderColor: "var(--border)",
          }}
        >
          {notice}
        </div>
      ) : null}
    </div>
  );
}
