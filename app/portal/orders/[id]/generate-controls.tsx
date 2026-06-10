"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import { postAction } from "./finalize-controls";

/**
 * Booklet-Generierung im Portal (Schritt 8a-1). Zwei kleine Client-Komponenten
 * mit geteilter Logik (`postGenerate` + Fehler-Mapping), `div + onClick`, kein
 * `<form>`:
 *
 *  - `<GenerateButton>` (Status `finalized`): prominenter „Vorschau erzeugen"-
 *    Button am Seitenende → `POST generate` → `router.refresh()`.
 *  - `<GeneratedBanner>` (Status `generated`): Banner „Booklet generiert" mit
 *    „Neu generieren" (erneutes `POST generate`, überschreibt das Intro, behält
 *    den Token) und „Wieder bearbeiten" (Reopen, geteilt über `postAction`).
 *    Hinweis „Vorschau-Seite folgt" — der /b/[token]-Link kommt erst in 8a-2.
 *
 * ISOLATION: kein Body; Betrieb/Order werden im Route Handler gegen die Session
 * geprüft, die `business_id` stammt aus der geladenen Order.
 */

/** POST auf `generate` (kein Body — Session + Order entscheiden serverseitig). */
async function postGenerate(orderId: string): Promise<Response> {
  return fetch(`/api/portal/orders/${orderId}/generate`, { method: "POST" });
}

/** Server-Fehlercode → i18n-Hinweis (need_media / ai_not_configured / sonst). */
async function noticeForError(res: Response): Promise<string> {
  let code = "";
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") code = body.error;
  } catch {
    // kein/ungültiger Body → generischer Fehler unten
  }
  if (code === "need_media") return t(DEFAULT_LOCALE, "generate.needMedia");
  if (code === "ai_not_configured") {
    return t(DEFAULT_LOCALE, "generate.aiNotConfigured");
  }
  return t(DEFAULT_LOCALE, "generate.error");
}

/** Roter Hinweis-Kasten (geteilt von Button + Banner). */
function NoticeBox({ text }: { text: string }) {
  return (
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
      {text}
    </div>
  );
}

/** Prominenter „Vorschau erzeugen"-Button (Status `finalized`). */
export function GenerateButton({
  orderId,
  mediaCount,
}: {
  orderId: string;
  mediaCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleGenerate = useCallback(() => {
    // Ohne Medium kein Request — direkt der Hinweis (Server prüft zusätzlich).
    if (mediaCount < 1) {
      setNotice(t(DEFAULT_LOCALE, "generate.needMedia"));
      return;
    }
    setBusy(true);
    setNotice(null);
    void (async () => {
      try {
        const res = await postGenerate(orderId);
        if (!res.ok) {
          setNotice(await noticeForError(res));
          setBusy(false);
          return;
        }
        router.refresh(); // Server rendert die Seite im Generiert-Modus neu
      } catch {
        setNotice(t(DEFAULT_LOCALE, "generate.error"));
        setBusy(false);
      }
    })();
  }, [mediaCount, orderId, router]);

  return (
    <div style={{ marginTop: 24 }}>
      <button
        type="button"
        className="btn-gold capture-btn"
        onClick={handleGenerate}
        disabled={busy}
        style={{ opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}
      >
        {busy
          ? t(DEFAULT_LOCALE, "generate.generating")
          : t(DEFAULT_LOCALE, "generate.generate")}
      </button>

      {notice ? <NoticeBox text={notice} /> : null}
    </div>
  );
}

/** Banner „Booklet generiert" + „Neu generieren" / „Wieder bearbeiten". */
export function GeneratedBanner({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "regenerate" | "reopen">(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(
    (action: "regenerate" | "reopen") => {
      setBusy(action);
      setNotice(null);
      void (async () => {
        try {
          const res =
            action === "regenerate"
              ? await postGenerate(orderId)
              : await postAction(orderId, "reopen");
          if (!res.ok) {
            setNotice(
              action === "regenerate"
                ? await noticeForError(res)
                : t(DEFAULT_LOCALE, "generate.error"),
            );
            setBusy(null);
            return;
          }
          router.refresh();
        } catch {
          setNotice(t(DEFAULT_LOCALE, "generate.error"));
          setBusy(null);
        }
      })();
    },
    [orderId, router],
  );

  const disabled = busy !== null;

  return (
    <div style={{ marginBottom: 20 }}>
      <div
        className="card"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
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
            fontSize: 14,
            fontWeight: 600,
            color: "#8A7320",
          }}
        >
          <SparkIcon />
          {t(DEFAULT_LOCALE, "generate.done")}
        </span>

        <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
          {t(DEFAULT_LOCALE, "generate.previewSoon")}
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 2 }}>
          <button
            type="button"
            className="btn-gold"
            onClick={() => run("regenerate")}
            disabled={disabled}
            style={{
              opacity: disabled ? 0.6 : 1,
              cursor: disabled ? "default" : "pointer",
            }}
          >
            {busy === "regenerate"
              ? t(DEFAULT_LOCALE, "generate.generating")
              : t(DEFAULT_LOCALE, "generate.regenerate")}
          </button>
          <button
            type="button"
            className="btn-outline"
            onClick={() => run("reopen")}
            disabled={disabled}
            style={{
              opacity: disabled ? 0.6 : 1,
              cursor: disabled ? "default" : "pointer",
            }}
          >
            {t(DEFAULT_LOCALE, "finalize.reopen")}
          </button>
        </div>
      </div>

      {notice ? <NoticeBox text={notice} /> : null}
    </div>
  );
}

/** Funke für das Generiert-Banner. Reine Deko. */
function SparkIcon() {
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
      <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
      <path d="M19 14l.8 2 2 .8-2 .8L19 20l-.8-2-2-.8 2-.8L19 14z" />
    </svg>
  );
}
