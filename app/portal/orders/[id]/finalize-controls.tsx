"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/**
 * Finalize-/Reopen-Steuerung des mobilen Assemblers (6c). Zwei kleine Client-
 * Komponenten mit unterschiedlicher Platzierung, aber geteilter Logik
 * (`postAction` + `router.refresh()`):
 *
 *  - `<FinalizeButton>` (Status `draft`): prominenter „Booklet abschließen"-
 *    Button am Seitenende. Vor dem POST eine Bestätigung; ohne Medium gar kein
 *    Request, sondern direkt der Hinweis (der Server prüft zusätzlich, 6c-Route).
 *  - `<FinalizeBanner>` (Status `finalized`): Banner „Booklet abgeschlossen"
 *    am Seitenkopf mit „Wieder bearbeiten" (Reopen → zurück in den Editier-Modus).
 *
 * ISOLATION: Beide POSTen ohne Body; Betrieb/Order werden im Route Handler
 * gegen die Session geprüft.
 */

/** Gemeinsamer POST auf `finalize`/`reopen` (kein Body — Session entscheidet). */
async function postAction(
  orderId: string,
  action: "finalize" | "reopen",
): Promise<Response> {
  return fetch(`/api/portal/orders/${orderId}/${action}`, { method: "POST" });
}

/** Prominenter „Booklet abschließen"-Button (nur im Editier-Modus, Status `draft`). */
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
    if (
      !window.confirm(
        `${t(DEFAULT_LOCALE, "finalize.confirm")}\n\n${t(DEFAULT_LOCALE, "finalize.confirmText")}`,
      )
    ) {
      return;
    }

    setBusy(true);
    setNotice(null);
    void (async () => {
      try {
        const res = await postAction(orderId, "finalize");
        if (!res.ok) throw new Error("finalize_failed");
        router.refresh(); // Server rendert die Seite im Abgeschlossen-Modus neu
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

/** Banner „Booklet abgeschlossen" + „Wieder bearbeiten" (Status `finalized`). */
export function FinalizeBanner({ orderId }: { orderId: string }) {
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
    <div style={{ marginBottom: 20 }}>
      <div
        className="card"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          background: "var(--gold-light)",
          borderColor: "var(--gold-border)",
          padding: "14px 16px",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
            fontSize: 14,
            fontWeight: 600,
            color: "#8A7320",
          }}
        >
          <CheckIcon />
          {t(DEFAULT_LOCALE, "finalize.done")}
        </span>
        <button
          type="button"
          className="btn-outline"
          onClick={handleReopen}
          disabled={busy}
          style={{
            flexShrink: 0,
            opacity: busy ? 0.6 : 1,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {t(DEFAULT_LOCALE, "finalize.reopen")}
        </button>
      </div>

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

/** Häkchen für das Abgeschlossen-Banner. Reine Deko. */
function CheckIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
