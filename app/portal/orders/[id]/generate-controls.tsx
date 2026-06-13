"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/**
 * Booklet-Aktionen der Detailseite — gebündeltes „Control Center" am Seitenende
 * (Layout-Umbau). Kleine Client-Komponenten, `div/button + onClick`, kein
 * `<form>`. Die Logik der Routen (generate/reopen/render-reel/reel-status) ist
 * UNVERÄNDERT; nur Anordnung + Benennung wurden aufgeräumt.
 *
 *  - `<CreateBookletButton>`: der EINE „Booklet erstellen"-Schritt. Im `draft`
 *    aktiv ⇒ `POST generate` (führt direkt `draft → generated` aus: KI-Texte +
 *    Kunden-Link). Im `generated` als erledigter, grauer Zustand (`disabled`,
 *    via `<DoneButton>`) — das Booklet existiert bereits.
 *  - `<ReopenButton>` (Status `generated`): „Bearbeiten" ⇒ `POST reopen`
 *    (`generated → draft`), zurück in den Editier-Modus. Token/Kurzlink bleiben.
 *  - `<ReelCreateButton>`: erstellt das echte Reel (Render + Poll), ab
 *    `generated` und auch nach Versand (FIX 7.1). Fertig gerendert ⇒ grauer
 *    „✓ Reel erstellt"-Zustand (KEIN „Neu erstellen" mehr — Neu-Rendern nur über
 *    „Bearbeiten" → erneut „Booklet erstellen", das das Reel serverseitig
 *    zurücksetzt). Bei Erfolg `router.refresh()`, damit der Watch-Button (#4) +
 *    die Auslieferungs-Warnung den fertigen Stand vom Server bekommen.
 *  - `<ReelWatchButton>`: „Reel ansehen" — öffnet das fertige Reel im In-App-
 *    Overlay (`<ReelViewer>`, Schließen-X, kein Browser-Tab-Sackgasse). Liegt in
 *    der Ansehen-Zeile (#4) zusammen mit „Booklet ansehen"/„QR drucken".
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
 * Geteilt von „Booklet erstellt" (Status `generated`) und „Reel erstellt"
 * (reel_status='ready') — eine Optik, kein Duplikat.
 */
function DoneButton({ label }: { label: string }) {
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
 * Der eine „Booklet erstellen"-Schritt (Slot 1 der Aktionszone).
 *
 *  - `disabled` (Status `generated`): Booklet existiert ⇒ grauer, nicht
 *    klickbarer „✓ Booklet erstellt"-Zustand. Geändert/neu erzeugt wird über
 *    „Bearbeiten" (Reopen) → erneut „Booklet erstellen".
 *  - sonst (Status `draft`): aktiv ⇒ `POST generate`, das in EINEM Schritt
 *    `draft → generated` ausführt (KI-Texte + Kunden-Link). Ohne process-Medium
 *    kein Request (Server prüft zusätzlich, `need_process`). Während des
 *    KI-Laufs Busy-Label + Spinner; Fehler ⇒ der Auftrag bleibt sauber `draft`
 *    (Route-Fehlersicherheit), der Nutzer kann erneut tippen.
 */
export function CreateBookletButton({
  orderId,
  processCount,
  disabled = false,
}: {
  orderId: string;
  /** Anzahl process-Medien (0010) — Pflicht fürs Erstellen, before/after zählen nicht. */
  processCount: number;
  /** true ⇒ Booklet existiert bereits (Status `generated`): erledigter, grauer Zustand. */
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleCreate = useCallback(() => {
    // Ohne process-Medium kein Request — direkt der Hinweis (Server prüft zusätzlich).
    if (processCount < 1) {
      setNotice(t(DEFAULT_LOCALE, "generate.needProcess"));
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
        // Lade-Zustand IMMER zurücksetzen — nie ein Dauer-„Erstelle…".
        setBusy(false);
      }
    })();
  }, [processCount, orderId, router]);

  // Generiert: das Booklet existiert ⇒ grauer, erledigter Zustand (kein Klick).
  if (disabled) {
    return <DoneButton label={t(DEFAULT_LOCALE, "generate.created")} />;
  }

  // Entwurf: ein Klick erzeugt das ganze Booklet (draft → generated).
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
            {t(DEFAULT_LOCALE, "generate.generating")}
          </>
        ) : (
          t(DEFAULT_LOCALE, "generate.generate")
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
 * „Reel erstellen" (Slot 2 der Aktionszone) — asynchroner Render mit Status-Poll
 * (Schritt 8b-1a, Logik UNVERÄNDERT).
 *
 * Opt-in (= Kostenkontrolle): Klick startet `POST render-reel` (Server antwortet
 * 202 + setzt reel_status='rendering'), danach wird `reel-status` alle ~3 s
 * gepollt. Bei `ready` ⇒ grauer „✓ Reel erstellt"-Zustand (`<DoneButton>`) +
 * `router.refresh()` — der Server liefert dann die signierte Reel-URL nach, der
 * Watch-Button (#4) erscheint und die Auslieferungs-Warnung verschwindet. Bei
 * `failed` ⇒ Fehlerhinweis + „Erneut".
 *
 * KEIN „Neu erstellen" mehr: ein fertiges Reel neu zu rendern geht nur über
 * „Bearbeiten" → erneut „Booklet erstellen" — das setzt reel_status server-
 * seitig auf `pending` zurück (Stale-Reel: der alte, auf veraltetem Booklet-
 * Stand basierende Render wird verworfen), wodurch dieser Button wieder aktiv ist.
 *
 * Der Anfangsstatus kommt vom Server (Reload zeigt den persistenten Stand); steht
 * er auf `rendering`, nimmt der Poll automatisch wieder auf.
 */
export function ReelCreateButton({
  orderId,
  initialStatus,
}: {
  orderId: string;
  initialStatus: ReelStatus;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<ReelStatus>(initialStatus);
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

  // Solange gerendert wird, den Status pollen (sofort + alle REEL_POLL_MS). Bei
  // `ready` zusätzlich `router.refresh()` — die signierte Reel-URL (#4 Watch +
  // Deliver-Warnung) kommt vom Server, nicht aus dieser Komponente.
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
  }, [status, orderId, router]);

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
        setStatus("rendering");
      } catch (error) {
        console.error("reel: start failed", error);
        setNotice(t(DEFAULT_LOCALE, "reel.error"));
      } finally {
        setStarting(false);
      }
    })();
  }, [orderId]);

  // Fertig gerendert ⇒ grauer „✓ Reel erstellt"-Zustand (Ansehen liegt in #4).
  if (status === "ready") {
    return <DoneButton label={t(DEFAULT_LOCALE, "reel.created")} />;
  }

  const rendering = status === "rendering";
  const busy = starting || rendering;

  return (
    <div>
      <button
        type="button"
        className="btn-gold capture-btn"
        onClick={start}
        disabled={busy}
        style={{ opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}
      >
        {starting
          ? t(DEFAULT_LOCALE, "reel.starting")
          : rendering
            ? t(DEFAULT_LOCALE, "reel.rendering")
            : status === "failed"
              ? t(DEFAULT_LOCALE, "reel.retry")
              : t(DEFAULT_LOCALE, "reel.create")}
      </button>
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
