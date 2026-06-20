"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/**
 * Booklet-Aktionen der Detailseite — gebündeltes „Control Center" am Seitenende.
 * Kleine Client-Komponenten, `div/button + onClick`, kein `<form>`. Die Logik der
 * Routen (generate/reopen/render-reel/reel-status) ist UNVERÄNDERT; B2a ändert
 * nur die UI-Präsentation.
 *
 *  - `<CreateBookletButton>`: der EINE kombinierte „Booklet & Reel erzeugen"-
 *    Schritt (B2a). Klick ⇒ `POST generate` (Sofort-202; Server baut Booklet-
 *    Shell + Texte und rendert das Reel im Hintergrund). Während des POST kurz
 *    „Bitte warten…"; sobald die 202-ANTWORT da ist (an die Antwort gebunden,
 *    NICHT an einen Timer) übergibt der Button an `<RenderingProgress>`. Bei
 *    einem Fehler VOR dem 202: Fehlertext, der Button bleibt als Erneut-Aktion.
 *    Optionales `label` (Failed-Retry „Erneut erstellen") + `initialNotice`.
 *  - `<RenderingProgress>`: die geteilte Zwei-Zustand-/Hintergrund-Anzeige
 *    („Läuft im Hintergrund — diese Seite kann verlassen werden.") + reel-status-
 *    Poll. Bei `ready`/`failed` ⇒ `router.refresh()`. Zwei Einsatzorte, EINE
 *    Logik: Hand-off direkt nach dem 202 UND Resume beim Reload eines noch
 *    rendernden Auftrags (page.tsx rendert sie bei reel_status ∈ {pending,
 *    rendering}). Ersetzt den früheren opt-in `ReelCreateButton`.
 *  - `<RetryReelButton>` (B2b, Status `generated` + reel_status='failed' bei
 *    VORHANDENEM Intro): Retry NUR des Reels (`POST render-reel`) — kein neuer
 *    Sonnet-Intro-Call. Modelliert nach dem kombinierten Button-Lifecycle, aber
 *    gegen render-reel; nach dem 202 übergibt er an `<RenderingProgress>` (Poll
 *    1:1 wiederverwendet, keine neue Poll-Logik).
 *  - `<ReopenButton>` (Status `generated`): „Bearbeiten" ⇒ `POST reopen`
 *    (`generated → draft`), zurück in den Editier-Modus. Token/Kurzlink bleiben.
 *  - `<ReelWatchButton>`: „Reel ansehen" — öffnet das fertige Reel im In-App-
 *    Overlay (`<ReelViewer>`, Schließen-X, kein Browser-Tab-Sackgasse). Liegt in
 *    der Ansehen-Zeile zusammen mit „Booklet ansehen"/„QR drucken".
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
    code === "need_process"
      ? t(DEFAULT_LOCALE, "generate.needProcess")
      : code === "need_media"
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

/**
 * Erledigter, grauer „✓ {label}"-Zustand über die volle Breite (nicht klickbar).
 * In B2a die „Fertig"-Bestätigung des `generated`+`ready`-Zustands (Booklet +
 * Reel stehen) — von page.tsx gerendert. Eine Optik, kein Duplikat.
 */
export function DoneButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="capture-btn"
      disabled
      aria-disabled
      style={{
        width: "100%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        background: "var(--surface-2)",
        color: "var(--text-secondary)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        fontFamily: "inherit",
        fontWeight: 600,
        cursor: "default",
      }}
    >
      ✓ {label}
    </button>
  );
}

/**
 * Der kombinierte „Booklet & Reel erzeugen"-Schritt (B2a).
 *
 * Klick ⇒ `POST generate` (Sofort-202: der Server baut die Booklet-Shell + Texte
 * und stößt den Reel-Render im Hintergrund an, reel_status='rendering'). Lebens-
 * zyklus des Buttons:
 *   idle  → (Klick, ohne process-Medium: Hinweis, kein Request)
 *   waiting (POST läuft, „Bitte warten…")
 *   → 202-ANTWORT erhalten ⇒ rendering: übergibt an `<RenderingProgress>`
 *     (Hintergrund-Message + Poll). Der Wechsel ist an die ANTWORT gebunden,
 *     NICHT an einen Timer.
 *   → Fehler VOR dem 202 (non-2xx/Netzwerk): zurück auf idle + Fehlertext; der
 *     sichtbare Button wiederholt denselben POST (= „Erneut"). NICHT die
 *     Hintergrund-Message zeigen.
 *
 * `label` überschreibt das Default-Label (Failed-Retry: „Erneut erstellen");
 * `initialNotice` blendet beim Mount einen Hinweis ein (Failed-Retry:
 * „Erstellung fehlgeschlagen"). Ohne process-Medium kein Request (Server prüft
 * zusätzlich, `need_process`).
 */
export function CreateBookletButton({
  orderId,
  processCount,
  label,
  initialNotice = null,
}: {
  orderId: string;
  /** Anzahl process-Medien (0010) — Pflicht fürs Erstellen, before/after zählen nicht. */
  processCount: number;
  /** Button-Label; Default „Booklet & Reel erzeugen". Failed-Retry: „Erneut erstellen". */
  label?: string;
  /** Vorbelegter Hinweis (z. B. „Erstellung fehlgeschlagen" beim Retry nach Fehlschlag). */
  initialNotice?: string | null;
}) {
  const [phase, setPhase] = useState<"idle" | "waiting" | "rendering">("idle");
  const [notice, setNotice] = useState<string | null>(initialNotice);

  const handleCreate = useCallback(() => {
    // Ohne process-Medium kein Request — direkt der Hinweis (Server prüft zusätzlich).
    if (processCount < 1) {
      setNotice(t(DEFAULT_LOCALE, "generate.needProcess"));
      return;
    }
    setPhase("waiting");
    setNotice(null);
    void (async () => {
      try {
        const res = await postGenerate(orderId);
        if (!res.ok) {
          // Fehler VOR dem 202: zurück auf den (Erneut-)Button + Fehlertext,
          // KEINE Hintergrund-Message. Ein erneuter Klick wiederholt den POST.
          setNotice(await noticeForError(res));
          setPhase("idle");
          return;
        }
        // 202 erhalten ⇒ Booklet-Shell steht, Reel rendert im Hintergrund. Erst
        // JETZT — an die ANTWORT gebunden, NICHT an einen Timer — in den
        // Hintergrund-Zustand wechseln (Poll + Seite verlassbar).
        setPhase("rendering");
      } catch (error) {
        setNotice(noticeForThrow(error));
        setPhase("idle");
      }
    })();
  }, [processCount, orderId]);

  // Nach dem 202: an die geteilte Fortschritts-Komponente übergeben (Poll +
  // refresh bei ready/failed). Dieselbe Komponente nimmt beim Reload den
  // laufenden Render automatisch wieder auf (Resume; s. page.tsx).
  if (phase === "rendering") {
    return <RenderingProgress orderId={orderId} initialStatus="rendering" />;
  }

  const busy = phase === "waiting";

  return (
    <div>
      <button
        type="button"
        className="btn-gold capture-btn"
        onClick={handleCreate}
        disabled={busy}
        style={{ opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}
      >
        {busy ? (
          <>
            <Spinner />
            {t(DEFAULT_LOCALE, "generate.waiting")}
          </>
        ) : (
          label ?? t(DEFAULT_LOCALE, "generate.combined")
        )}
      </button>

      <p style={{ marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>
        {t(DEFAULT_LOCALE, "generate.hint")}
      </p>

      {notice ? <NoticeBox text={notice} /> : null}
    </div>
  );
}

/**
 * „Bearbeiten"-Button (Status `generated`): `POST reopen` (`generated → draft`),
 * zurück in den Editier-Modus. Das Booklet (Token/Kurzlink) bleibt bestehen;
 * ein erneutes „Booklet erstellen" generiert die Texte neu, ohne den Link zu
 * ändern. Kein Body — Betrieb/Order werden serverseitig gegen die Session geprüft.
 */
export function ReopenButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleReopen = useCallback(() => {
    setBusy(true);
    setNotice(null);
    void (async () => {
      try {
        const res = await fetch(`/api/portal/orders/${orderId}/reopen`, {
          method: "POST",
        });
        if (!res.ok) throw new Error("reopen_failed");
        router.refresh(); // zurück in den Editier-Modus
      } catch {
        setNotice(t(DEFAULT_LOCALE, "reopen.error"));
        setBusy(false);
      }
    })();
  }, [orderId, router]);

  return (
    <div>
      <button
        type="button"
        className="btn-outline"
        onClick={handleReopen}
        disabled={busy}
        style={{
          width: "100%",
          opacity: busy ? 0.6 : 1,
          cursor: busy ? "default" : "pointer",
        }}
      >
        {t(DEFAULT_LOCALE, "reopen.button")}
      </button>
      {notice ? <NoticeBox text={notice} /> : null}
    </div>
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

/**
 * Geteilte Hintergrund-/Zwei-Zustand-Anzeige (B2a). Zeigt die Botschaft „Läuft
 * im Hintergrund — diese Seite kann verlassen werden." (zweite Zeile: die rein
 * kosmetischen REEL_STAGES, keine echte Telemetrie) und pollt `reel-status` alle
 * ~3 s. Bei `ready` ODER `failed` ⇒ `router.refresh()` — der Server rendert dann
 * den passenden Zweig (Fertig bzw. Fehler/Erneut). KEINE clientseitige Fehler-
 * Diskriminierung (folgt B2b).
 *
 * Zwei Einsatzorte, EINE Logik:
 *  - Hand-off direkt nach dem 202 des kombinierten Buttons, und
 *  - Resume beim Reload eines noch rendernden Auftrags (page.tsx rendert die
 *    Komponente, wenn reel_status ∈ {pending, rendering}).
 *
 * Der Render selbst (`POST generate` → `after()`) läuft serverseitig; diese
 * Komponente startet KEINEN Render, sie beobachtet nur.
 */
export function RenderingProgress({
  orderId,
  initialStatus,
}: {
  orderId: string;
  initialStatus: ReelStatus;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<ReelStatus>(initialStatus);
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

  // Solange gerendert wird, den Status pollen (sofort + alle REEL_POLL_MS). Bei
  // ready/failed `router.refresh()` — der Server rendert den Folge-Zweig (fertig
  // bzw. Fehler); die signierte Reel-URL/Deliver-Warnung kommen vom Server.
  useEffect(() => {
    if (status !== "rendering") return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/portal/orders/${orderId}/reel-status`);
        if (!res.ok) return; // transient → nächster Tick
        const body = (await res.json()) as { status?: unknown };
        if (cancelled) return;
        if (body.status === "ready") {
          setStatus("ready");
          router.refresh();
        } else if (body.status === "failed") {
          setStatus("failed");
          router.refresh();
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
  }, [status, orderId, router]);

  return (
    <div>
      <p
        aria-live="polite"
        style={{
          margin: 0,
          fontSize: 14,
          fontWeight: 600,
          color: "var(--text-primary)",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Spinner />
        {t(DEFAULT_LOCALE, "generate.background")}
      </p>
      <p style={{ marginTop: 6, fontSize: 13, color: "var(--gold)" }}>
        {t(DEFAULT_LOCALE, REEL_STAGES[stageIdx] ?? "reel.rendering")}
      </p>
    </div>
  );
}

/**
 * „Reel erneut"-Button (B2b). Greift im `generated`+`reel_status='failed'`-
 * Zweig, wenn das Intro bereits steht (intro_title vorhanden): dann scheiterte
 * NUR das Reel — ein voller Neulauf (POST generate) würde unnötig einen neuen
 * Sonnet-Intro-Call brennen. Dieser Button retryt deshalb NUR das Reel
 * (`POST render-reel`).
 *
 * Modelliert nach dem kombinierten Button-Lifecycle (`<CreateBookletButton>`),
 * aber gegen render-reel statt generate:
 *   idle („Reel erneut") → Klick → „Bitte warten…" → POST render-reel
 *   → 202 ⇒ Übergabe an `<RenderingProgress initialStatus="rendering">`
 *     (geteilte Hintergrund-Message + Poll; KEINE neue Poll-Logik).
 *   → Fehler VOR dem 202 (non-2xx/Netzwerk) ⇒ zurück auf idle + Fehlertext; der
 *     sichtbare Button wiederholt den POST.
 *
 * `initialNotice` blendet beim Mount einen Hinweis ein (im failed-Zweig:
 * „Reel fehlgeschlagen"). Kein Body — Betrieb/Order werden serverseitig gegen
 * die Session geprüft.
 */
export function RetryReelButton({
  orderId,
  initialNotice = null,
}: {
  orderId: string;
  /** Vorbelegter Hinweis (im failed-Zweig: „Reel fehlgeschlagen"). */
  initialNotice?: string | null;
}) {
  const [phase, setPhase] = useState<"idle" | "waiting" | "rendering">("idle");
  const [notice, setNotice] = useState<string | null>(initialNotice);

  const handleRetry = useCallback(() => {
    setPhase("waiting");
    setNotice(null);
    void (async () => {
      try {
        const res = await fetch(`/api/portal/orders/${orderId}/render-reel`, {
          method: "POST",
        });
        if (!res.ok) {
          // Fehler VOR dem 202: zurück auf den (Erneut-)Button + Fehlertext.
          setNotice(await noticeForError(res));
          setPhase("idle");
          return;
        }
        // 202 erhalten ⇒ Reel rendert im Hintergrund. An die geteilte
        // Fortschritts-Komponente übergeben (Poll + refresh bei ready/failed).
        setPhase("rendering");
      } catch (error) {
        setNotice(noticeForThrow(error));
        setPhase("idle");
      }
    })();
  }, [orderId]);

  if (phase === "rendering") {
    return <RenderingProgress orderId={orderId} initialStatus="rendering" />;
  }

  const busy = phase === "waiting";

  return (
    <div>
      <button
        type="button"
        className="btn-gold capture-btn"
        onClick={handleRetry}
        disabled={busy}
        style={{ opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}
      >
        {busy ? (
          <>
            <Spinner />
            {t(DEFAULT_LOCALE, "generate.waiting")}
          </>
        ) : (
          t(DEFAULT_LOCALE, "generate.reelRetry")
        )}
      </button>
      {notice ? <NoticeBox text={notice} /> : null}
    </div>
  );
}

/**
 * „Reel ansehen" (Slot 4 der Aktionszone, neben „Booklet ansehen"/„QR drucken").
 * Öffnet das fertige Reel im In-App-Overlay (`<ReelViewer>` mit Schließen-X) —
 * kein roher mp4-Link in einem neuen Tab (Sackgasse). Wird nur gerendert, wenn
 * eine signierte Reel-URL vorliegt (Server, reel_status='ready').
 */
export function ReelWatchButton({ url }: { url: string }) {
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn-outline"
        onClick={() => setViewerUrl(url)}
      >
        <PlayIcon />
        {t(DEFAULT_LOCALE, "reel.watch")}
      </button>
      {viewerUrl ? (
        <ReelViewer url={viewerUrl} onClose={() => setViewerUrl(null)} />
      ) : null}
    </>
  );
}

/**
 * Vollbild-Overlay zum Abspielen des fertigen Reels (FIX 1). Klarer Ausweg:
 * ein gut sichtbares Schließen-X oben rechts (Notch-/Safe-Area-sicher) sowie
 * Escape und Backdrop-Klick führen zurück zur Auftrags-Detailseite. Kein
 * `<form>`; das X ist ein `<button>` mit `aria-label`.
 */
function ReelViewer({ url, onClose }: { url: string; onClose: () => void }) {
  // Escape schließt das Overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0, 0, 0, 0.9)",
      }}
    >
      <button
        type="button"
        aria-label={t(DEFAULT_LOCALE, "reel.close")}
        onClick={onClose}
        style={{
          position: "absolute",
          // Unter dem Notch/der Statusleiste, gut erreichbar.
          top: "calc(env(safe-area-inset-top, 0px) + 14px)",
          right: "calc(env(safe-area-inset-right, 0px) + 14px)",
          zIndex: 1,
          width: 44,
          height: 44,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 999,
          border: "none",
          background: "rgba(0, 0, 0, 0.55)",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        <CloseIcon />
      </button>

      {/* Hochformat-Reel: füllt die Höhe, behält 9:16. Klick aufs Video
          schließt nicht (stopPropagation) — nur Backdrop/X/Escape. */}
      <video
        src={url}
        controls
        autoPlay
        playsInline
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          borderRadius: "var(--radius)",
          background: "#000",
        }}
      />
    </div>
  );
}

/** Play-Symbol für „Reel ansehen" (öffnet den In-App-Viewer). Reine Deko. */
function PlayIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

/** Schließen-X für den Reel-Viewer (FIX 1). Reine Deko. */
function CloseIcon() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
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
