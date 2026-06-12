"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import { postAction } from "./finalize-controls";

/**
 * Booklet-Generierung im Portal (Schritt 8a-1). Zwei kleine Client-Komponenten
 * mit geteilter Logik (`postGenerate` + Fehler-Mapping), `div + onClick`, kein
 * `<form>`:
 *
 *  - `<GenerateButton>` (Status `finalized`): prominenter „Booklet erstellen"-
 *    Button am Seitenende (Schritt 2: KI-Texte + Kunden-Link) → `POST generate`
 *    → `router.refresh()`.
 *  - `<GeneratedActions>` (Status `generated`): kleine Sekundär-Aktionen für
 *    die obere Aktionsleiste — „Neu generieren" (erneutes `POST generate`,
 *    überschreibt das Intro, behält den Token) und „Bearbeiten" (Reopen,
 *    geteilt über `postAction`). Der „Booklet ansehen"-Link wird server-seitig
 *    in der Seite gerendert.
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

/** Prominenter „Booklet erstellen"-Button (Status `finalized`). */
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
    // Sitzt in der Aktionszone direkt unter dem „Medien abgeschlossen"-Häkchen.
    <div style={{ marginTop: 12 }}>
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

      <p style={{ marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>
        {t(DEFAULT_LOCALE, "generate.hint")}
      </p>

      {notice ? <NoticeBox text={notice} /> : null}
    </div>
  );
}

/**
 * Kleine Sekundär-Aktionen „Neu generieren" + „Bearbeiten" (Status `generated`).
 * Fragment — wird in der oberen Aktionsleiste der Detailseite neben den
 * Ansehen-/QR-Links gerendert; der Fehler-Hinweis bricht in eine eigene Zeile
 * (flexBasis 100%).
 */
export function GeneratedActions({ orderId }: { orderId: string }) {
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
    <>
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
      {notice ? (
        <div style={{ flexBasis: "100%" }}>
          <NoticeBox text={notice} />
        </div>
      ) : null}
    </>
  );
}

/** Reel-Render-Status (Spiegel von booklets.reel_status, 8b-1a). */
export type ReelStatus = "pending" | "rendering" | "ready" | "failed";

/** Poll-Intervall, solange der Render läuft. */
const REEL_POLL_MS = 3000;

/**
 * Rein kosmetische Fortschritts-Stufen während des Renders (keine echte
 * Telemetrie) — sie laufen sequenziell alle REEL_STAGE_MS durch und folgen der
 * Pipeline (Vorbereiten → Medien → Intro/Logo → Fotos/Captions → Clips →
 * Assembly → Outro → Feinschliff). Die letzte Stufe bleibt stehen (kein
 * Zurückspringen, kein Wiederholen), bis der Poll `ready`/`failed` meldet.
 */
const REEL_STAGE_MS = 4000;
const REEL_STAGES = [
  "reel.stage1",
  "reel.stage2",
  "reel.stage3",
  "reel.stage4",
  "reel.stage5",
  "reel.stage6",
  "reel.stage7",
  "reel.stage8",
  "reel.stage9",
  "reel.stage10",
  "reel.stage11",
  "reel.stage12",
  "reel.stage13",
  "reel.stage14",
] as const;

/** Server-Fehlercode des Render-Starts → i18n-Hinweis (+ technischer Detail-Teil). */
async function noticeForReelStart(res: Response): Promise<string> {
  let code = "";
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") code = body.error;
  } catch {
    // kein/ungültiger Body → generischer Fehler
  }
  const base =
    code === "need_media"
      ? t(DEFAULT_LOCALE, "reel.needMedia")
      : t(DEFAULT_LOCALE, "reel.error");
  const detail = code ? `${res.status} ${code}` : String(res.status);
  return `${base} (${detail})`;
}

/**
 * Echtes Foto-Reel (Schritt 8b-1a): asynchroner Render mit Status-Poll.
 *
 * Opt-in (= Kostenkontrolle): Klick auf „Reel erstellen" startet `POST render-reel`
 * (Server antwortet 202 + setzt reel_status='rendering'), danach wird
 * `reel-status` alle ~3 s gepollt: „Reel wird erstellt…" → bei `ready` ein Link
 * auf das signierte reel.mp4, bei `failed` ein Fehlerhinweis + „Erneut".
 *
 * Der Anfangsstatus kommt vom Server (Seiten-Reload zeigt den persistenten Stand);
 * steht er auf `rendering`, nimmt der Poll automatisch wieder auf.
 */
export function ReelButton({
  orderId,
  initialStatus,
  initialUrl,
}: {
  orderId: string;
  initialStatus: ReelStatus;
  initialUrl: string | null;
}) {
  const [status, setStatus] = useState<ReelStatus>(initialStatus);
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [notice, setNotice] = useState<string | null>(
    initialStatus === "failed" ? t(DEFAULT_LOCALE, "reel.failed") : null,
  );
  const [starting, setStarting] = useState(false);
  // Index der kosmetischen Render-Stufe (nur während `rendering` sichtbar).
  const [stageIdx, setStageIdx] = useState(0);

  // Stufentexte durchlaufen, solange gerendert wird; die letzte bleibt stehen.
  useEffect(() => {
    if (status !== "rendering") return;
    setStageIdx(0);
    const id = setInterval(() => {
      setStageIdx((i) => Math.min(i + 1, REEL_STAGES.length - 1));
    }, REEL_STAGE_MS);
    return () => clearInterval(id);
  }, [status]);

  // Solange gerendert wird, den Status pollen (sofort + alle REEL_POLL_MS).
  useEffect(() => {
    if (status !== "rendering") return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/portal/orders/${orderId}/reel-status`);
        if (!res.ok) return; // transient → nächster Tick
        const body = (await res.json()) as { status?: unknown; url?: unknown };
        if (cancelled) return;
        if (body.status === "ready") {
          setUrl(typeof body.url === "string" ? body.url : null);
          setStatus("ready");
        } else if (body.status === "failed") {
          setNotice(t(DEFAULT_LOCALE, "reel.failed"));
          setStatus("failed");
        }
      } catch {
        // transienter Netzwerkfehler — beim nächsten Tick erneut versuchen
      }
    };

    const id = setInterval(() => void poll(), REEL_POLL_MS);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [status, orderId]);

  const start = useCallback(() => {
    setStarting(true);
    setNotice(null);
    void (async () => {
      try {
        const res = await fetch(`/api/portal/orders/${orderId}/render-reel`, {
          method: "POST",
        });
        if (!res.ok) {
          setNotice(await noticeForReelStart(res));
          return;
        }
        // 202: Render läuft → in den Poll-Zustand wechseln.
        setUrl(null);
        setStatus("rendering");
      } catch (error) {
        console.error("reel: start failed", error);
        setNotice(t(DEFAULT_LOCALE, "reel.error"));
      } finally {
        setStarting(false);
      }
    })();
  }, [orderId]);

  const rendering = status === "rendering";
  const busy = starting || rendering;

  return (
    // Sitzt im Reel-Block der Aktionszone direkt unter der „Reel"-Überschrift.
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 10,
        }}
      >
        {status === "ready" && url ? (
          <a
            className="btn-gold"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLinkIcon />
            {t(DEFAULT_LOCALE, "reel.watch")}
          </a>
        ) : null}

        <button
          type="button"
          className={status === "ready" ? "btn-outline" : "btn-gold capture-btn"}
          onClick={start}
          disabled={busy}
          style={{ opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}
        >
          {starting
            ? t(DEFAULT_LOCALE, "reel.starting")
            : rendering
              ? t(DEFAULT_LOCALE, "reel.rendering")
              : status === "ready"
                ? t(DEFAULT_LOCALE, "reel.recreate")
                : status === "failed"
                  ? t(DEFAULT_LOCALE, "reel.retry")
                  : t(DEFAULT_LOCALE, "reel.create")}
        </button>
      </div>
      {rendering ? (
        <p
          aria-live="polite"
          style={{
            marginTop: 8,
            fontSize: 13,
            fontWeight: 600,
            color: "var(--gold)",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Spinner />
          {t(DEFAULT_LOCALE, REEL_STAGES[stageIdx] ?? "reel.rendering")}
        </p>
      ) : (
        <p style={{ marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>
          {t(DEFAULT_LOCALE, "reel.hint")}
        </p>
      )}
      {notice ? <NoticeBox text={notice} /> : null}
    </div>
  );
}

/** Externer-Link-Symbol für „Reel ansehen". Reine Deko. */
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

/** Kleiner rotierender Lade-Ring für die Render-Stufen. Reine Deko. */
function Spinner() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      aria-hidden
      style={{ flexShrink: 0, animation: "spin 0.9s linear infinite" }}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
