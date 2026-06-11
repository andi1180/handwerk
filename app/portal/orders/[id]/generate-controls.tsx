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
 *    „Vorschau öffnen" (öffnet /b/[token] in neuem Tab, 8a-2), „Neu generieren"
 *    (erneutes `POST generate`, überschreibt das Intro, behält den Token) und
 *    „Wieder bearbeiten" (Reopen, geteilt über `postAction`).
 *
 * ISOLATION: kein Body; Betrieb/Order werden im Route Handler gegen die Session
 * geprüft, die `business_id` stammt aus der geladenen Order.
 */

/** Antwortet die Generierung (Sonnet) nicht, wird hart abgebrochen. */
const GENERATE_TIMEOUT_MS = 60_000;

/**
 * POST auf `generate` (kein Body — Session + Order entscheiden serverseitig).
 * Mit AbortController-Timeout: kommt nie eine Antwort, wirft `fetch` einen
 * AbortError statt ewig zu hängen.
 */
async function postGenerate(orderId: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
  try {
    return await fetch(`/api/portal/orders/${orderId}/generate`, {
      method: "POST",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Server-Fehlercode → i18n-Hinweis (need_media / ai_not_configured / sonst).
 * Hängt den technischen Diagnose-Teil (HTTP-Status + error-Code) an, damit ein
 * Fehler im UI sichtbar und nachvollziehbar ist (kein stilles Hängen).
 */
async function noticeForError(res: Response): Promise<string> {
  let code = "";
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") code = body.error;
  } catch {
    // kein/ungültiger Body → generischer Fehler unten
  }
  const base =
    code === "need_media"
      ? t(DEFAULT_LOCALE, "generate.needMedia")
      : code === "ai_not_configured"
        ? t(DEFAULT_LOCALE, "generate.aiNotConfigured")
        : t(DEFAULT_LOCALE, "generate.error");
  const detail = code ? `${res.status} ${code}` : String(res.status);
  return `${base} (${detail})`;
}

/** AbortError (Timeout) → eigener Hinweis, sonst generischer Fehler. */
function noticeForThrow(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return t(DEFAULT_LOCALE, "generate.timeout");
  }
  console.error("generate: request failed", error);
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
          return;
        }
        router.refresh(); // Server rendert die Seite im Generiert-Modus neu
      } catch (error) {
        setNotice(noticeForThrow(error));
      } finally {
        // Lade-Zustand IMMER zurücksetzen — nie ein Dauer-„Erzeuge…".
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

/** Banner „Booklet generiert" + „Vorschau öffnen" / „Neu generieren" / „Wieder bearbeiten". */
export function GeneratedBanner({
  orderId,
  token,
}: {
  orderId: string;
  token: string | null;
}) {
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
            return;
          }
          router.refresh();
        } catch (error) {
          setNotice(noticeForThrow(error));
        } finally {
          // Lade-Zustand IMMER zurücksetzen — nie ein Dauer-„Erzeuge…".
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

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 2 }}>
          {/* Primär-Aktion: die fertige Story prüfen (öffnet /b/[token]). */}
          {token ? (
            <a
              className="btn-gold"
              href={`/b/${token}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLinkIcon />
              {t(DEFAULT_LOCALE, "generate.openPreview")}
            </a>
          ) : null}
          <button
            type="button"
            className="btn-outline"
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

/** Client-Timeout: der Render darf etwas dauern (Download + ffmpeg + Upload), aber nie ewig hängen. */
const REEL_TEST_TIMEOUT_MS = 180_000;

/**
 * Provisorischer FFmpeg-Infra-Test (Schritt 8b-0v2): POST auf `render-reel-test`,
 * zeigt bei Erfolg einen Link zum erzeugten Test-mp4. KEIN echtes Reel — beweist
 * nur, dass ffmpeg in der Vercel-Function läuft (Binary zur Laufzeit aus dem
 * Storage geladen) und der Output im Storage landet. Wird in 8b-1 durch das echte
 * „Reel erstellen" ersetzt. Lade-/Fehler-State via try/finally (nie ein Dauer-
 * „Rendere…"), mit AbortController-Timeout.
 */
export function ReelTestButton({ orderId }: { orderId: string }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleRender = useCallback(() => {
    setBusy(true);
    setNotice(null);
    setUrl(null);
    void (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REEL_TEST_TIMEOUT_MS);
      try {
        const res = await fetch(
          `/api/portal/orders/${orderId}/render-reel-test`,
          { method: "POST", signal: controller.signal },
        );
        if (!res.ok) {
          let code = "";
          try {
            const body = (await res.json()) as { error?: unknown };
            if (typeof body.error === "string") code = body.error;
          } catch {
            // kein/ungültiger Body → nur HTTP-Status zeigen
          }
          const detail = code ? `${res.status} ${code}` : String(res.status);
          setNotice(`${t(DEFAULT_LOCALE, "reelTest.error")} (${detail})`);
          return;
        }
        const body = (await res.json()) as { url?: unknown };
        if (typeof body.url === "string") {
          setUrl(body.url);
        } else {
          setNotice(t(DEFAULT_LOCALE, "reelTest.error"));
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setNotice(t(DEFAULT_LOCALE, "reelTest.timeout"));
        } else {
          console.error("reel-test: request failed", error);
          setNotice(t(DEFAULT_LOCALE, "reelTest.error"));
        }
      } finally {
        // Lade-Zustand IMMER zurücksetzen — nie ein Dauer-„Rendere…".
        clearTimeout(timer);
        setBusy(false);
      }
    })();
  }, [orderId]);

  return (
    <div style={{ marginTop: 24 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 10,
        }}
      >
        <button
          type="button"
          className="btn-outline"
          onClick={handleRender}
          disabled={busy}
          style={{
            opacity: busy ? 0.6 : 1,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy
            ? t(DEFAULT_LOCALE, "reelTest.rendering")
            : t(DEFAULT_LOCALE, "reelTest.button")}
        </button>
        {url ? (
          <a
            className="btn-gold"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLinkIcon />
            {t(DEFAULT_LOCALE, "reelTest.open")}
          </a>
        ) : null}
      </div>
      <p style={{ marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>
        {t(DEFAULT_LOCALE, "reelTest.hint")}
      </p>
      {notice ? <NoticeBox text={notice} /> : null}
    </div>
  );
}

/** Externer-Link-Symbol für „Vorschau öffnen". Reine Deko. */
function ExternalLinkIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14L21 3" />
    </svg>
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
