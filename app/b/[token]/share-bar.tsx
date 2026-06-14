"use client";

import { useEffect, useRef, useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import { trackBookletEvent } from "@/lib/booklet/track";

/** Welcher „✓ kopiert"-Flash gerade aktiv ist (immer nur einer). */
type CopiedKey = "link" | "review";

/**
 * Teilen-Sektion der öffentlichen Web-Story — der WOM-Kern.
 *
 * SSR-sicher: `window`/`navigator` werden ausschließlich in Handlern/Effects
 * berührt, nie beim Render. Buttons sind `div + onClick` (kein `<form>`).
 *
 * Bewusst auf drei Aktionen reduziert (in dieser Reihenfolge):
 * 1. „Booklet teilen" (PRIMÄR): die Story-URL via `navigator.share({ url })`,
 *    Fallback = Link kopieren. Teilt die NACKTE `storyUrl` (ohne Marker, §9d).
 *    Feuert `shared/story`.
 * 2. „Als Insta/TikTok-Story teilen": das fertige Reel als Datei via
 *    `navigator.share({ files })` (öffnet den IG/TikTok-Composer); ohne
 *    File-Sharing (Desktop) Fallback = Download. Nur sichtbar, wenn ein Reel
 *    vorliegt (`reelSignedUrl`). Feuert `shared/reel`.
 * 3. „Google-Bewertung schreiben": nur wenn `googleReviewUrl` UND `reviewDraft`.
 *    Klick → Entwurf in die Zwischenablage + Deeplink zum Google-Profil.
 *    §8.6-PFLICHT: Framing „Vorschlag, gern in deinen Worten anpassen" (NICHT
 *    „Text einfügen"), und NIEMALS an eine Belohnung gekoppelt.
 *
 * Hinweis: WhatsApp / „Link kopieren" / IG-Caption sind aus der UI entfernt;
 * die Event-Taxonomie (whatsapp/copy/ig in lib/booklet/events.ts) bleibt
 * unverändert gültig — nur die Buttons feuern sie nicht mehr.
 */
export function ShareBar({
  token,
  storyUrl,
  reelSignedUrl,
  reviewDraft,
  googleReviewUrl,
  locale,
}: {
  token: string;
  storyUrl: string;
  reelSignedUrl: string | null;
  reviewDraft: string | null;
  googleReviewUrl: string | null;
  locale: Locale;
}) {
  const [copiedKey, setCopiedKey] = useState<CopiedKey | null>(null);
  // Optimistisch: die Zielgruppe (Kunde am Handy) kann i. d. R. Dateien teilen.
  // Nach dem Mount per Capability-Probe ggf. auf „Herunterladen" korrigiert.
  const [canShareFiles, setCanShareFiles] = useState(true);
  // Die fertig vorab geladene Reel-Datei (Prefetch) — bereit, sobald gesetzt.
  const reelFileRef = useRef<File | null>(null);
  const [reelReady, setReelReady] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Capability-Probe + Reel-PREFETCH beim Mount.
  //
  // Auf iOS Safari verbraucht ein `await` zwischen User-Geste und
  // `navigator.share` die transient activation → der erste Tap wirft (geschluckt),
  // erst der zweite teilt. Deshalb laden wir die Reel-Datei VORAB in einen Ref,
  // damit der Klick-Handler `navigator.share({ files })` SYNCHRON aus der Geste
  // aufrufen kann. Die ShareBar rendert nur in der Kunden-Sicht (?c=1), also genau
  // für den beabsichtigten Teiler — der Prefetch-Cost fällt nicht bei Empfängern an.
  useEffect(() => {
    let canShare = false;
    try {
      const probe = new File([new Blob([], { type: "video/mp4" })], "probe.mp4", {
        type: "video/mp4",
      });
      canShare =
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [probe] });
    } catch {
      canShare = false;
    }
    setCanShareFiles(canShare);

    // Prefetch nur, wenn ein Reel vorliegt UND Datei-Sharing möglich ist
    // (sonst greift der Download-Fallback, der die URL direkt nutzt).
    if (!reelSignedUrl || !canShare) return;
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(reelSignedUrl, { signal: controller.signal });
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        reelFileRef.current = new File([blob], "reel.mp4", { type: "video/mp4" });
        setReelReady(true);
      } catch {
        // Prefetch fehlgeschlagen (Netz/CORS/Abbruch) → auf Download-Fallback
        // herabstufen: Button wird wieder bedienbar, Klick lädt herunter.
        if (!cancelled) setCanShareFiles(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reelSignedUrl]);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  function flashCopied(key: CopiedKey) {
    setCopiedKey(key);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedKey(null), 2000);
  }

  /** Text in die Zwischenablage + Flash; nur bei tatsächlichem Erfolg flashen. */
  async function copyText(text: string, key: CopiedKey): Promise<void> {
    if (await writeToClipboard(text)) flashCopied(key);
    // Schlägt selbst der Legacy-Fallback fehl (sehr selten), kein Fehler-Toast.
  }

  /** Pures Kopieren der Story-URL (Fallback von „Booklet teilen"). */
  function copyLink() {
    void copyText(storyUrl, "link");
  }

  async function writeReview() {
    if (!reviewDraft || !googleReviewUrl) return;
    trackBookletEvent(token, "link_click", "review");
    // §8.6: Entwurf bereitstellen (Clipboard, Doc ist hier noch fokussiert ⇒
    // zuverlässig) und DANN das Google-Profil im neuen Tab öffnen.
    await copyText(reviewDraft, "review");
    window.open(reviewHref(googleReviewUrl), "_blank", "noopener,noreferrer");
  }

  function downloadReel(url: string) {
    const a = document.createElement("a");
    a.href = url;
    a.download = "reel.mp4";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /** „Booklet teilen" (PRIMÄR): Story-URL teilen, Fallback = Link kopieren. */
  async function handleShareBooklet() {
    trackBookletEvent(token, "shared", "story");
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          url: storyUrl,
          title: t(locale, "share.shareTitle"),
          text: t(locale, "share.message"),
        });
      } catch {
        // Abbruch durch den Nutzer ist kein Fehler.
      }
    } else {
      copyLink();
    }
  }

  /**
   * „Als Insta/TikTok-Story teilen": Reel als Datei, Fallback = Download.
   *
   * SYNCHRON aus der Geste — KEIN await vor `navigator.share` (sonst geht auf
   * iOS Safari die transient activation verloren ⇒ Doppel-Tap). Die Datei wurde
   * beim Mount vorab geladen; solange das läuft, ist der Button disabled.
   */
  function handleShareReel() {
    if (!reelSignedUrl || reelLoading) return;
    // Reel teilen/Download zählt als shared/reel (Intent, unabhängig vom Pfad).
    trackBookletEvent(token, "shared", "reel");

    const file = reelFileRef.current;
    if (
      file &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [file] }) &&
      typeof navigator.share === "function"
    ) {
      navigator
        .share({ files: [file], title: t(locale, "share.shareTitle") })
        .catch(() => {
          // Abbruch durch den Nutzer ist kein Fehler — kein Toast, kein Download.
        });
      return;
    }
    // Keine teilbare Datei (kein File-Sharing / Prefetch verworfen) → Download.
    downloadReel(reelSignedUrl);
  }

  const showReview = Boolean(googleReviewUrl && reviewDraft);
  // Datei-Share-Pfad, aber Prefetch noch nicht fertig → Button disabled/Ladezustand.
  const reelLoading = canShareFiles && !reelReady;

  return (
    <div className="booklet-share booklet-frost">
      <p className="booklet-share-heading">{t(locale, "share.heading")}</p>

      <Pressable className="booklet-share-primary" onPress={handleShareBooklet}>
        <ShareIcon />
        <span>
          {copiedKey === "link"
            ? t(locale, "share.copied")
            : t(locale, "share.shareBooklet")}
        </span>
      </Pressable>

      {reelSignedUrl ? (
        <Pressable
          className="booklet-share-secondary"
          onPress={handleShareReel}
          disabled={reelLoading}
        >
          <InstagramIcon />
          <span>
            {reelLoading
              ? t(locale, "share.sharing")
              : canShareFiles
                ? t(locale, "share.shareReel")
                : t(locale, "share.download")}
          </span>
        </Pressable>
      ) : null}

      {showReview ? (
        <div className="booklet-review">
          <Pressable className="booklet-review-btn" onPress={writeReview}>
            <GoogleWordmark />
            <span>
              {copiedKey === "review"
                ? t(locale, "review.copied")
                : t(locale, "review.button")}
            </span>
          </Pressable>
          {/* §8.6: Vorschlag-Charakter (Textvorschlag/KI), im Google-Feld
              editierbar; kein Belohnungsbezug, keine Sterne-Vorgabe. */}
          <p className="booklet-review-hint">{t(locale, "review.hint")}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Externer Link bekommt ein Protokoll, falls der Betrieb keins gesetzt hat. */
function reviewHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/**
 * Robustes Kopieren — erst die moderne Clipboard-API, sonst der Legacy-Pfad.
 * Die Web-Story wird oft aus In-App-Webviews (WhatsApp/Instagram) geöffnet, wo
 * `navigator.clipboard` fehlt oder blockiert ist; dort greift `execCommand`,
 * damit der „ist kopiert"-Hinweis (Review) auch wirklich stimmt.
 * Gibt zurück, ob das Kopieren tatsächlich geklappt hat.
 */
async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Moderne API verweigert (kein HTTPS / kein Fokus) → Legacy-Fallback.
  }
  return legacyCopy(text);
}

/** Legacy-Kopierpfad (verstecktes <textarea> + execCommand) — best effort. */
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/* div-basierter Button (kein <form>): Klick + Tastatur (Enter/Space). */
function Pressable({
  className,
  onPress,
  disabled,
  children,
}: {
  className: string;
  onPress: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={className}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled ? true : undefined}
      onClick={() => {
        if (!disabled) onPress();
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPress();
        }
      }}
    >
      {children}
    </div>
  );
}

/* --- Icons (dekorativ, currentColor) --- */

function ShareIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 15V3" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.5" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * „Google" als farbiger Wortmarken-Schriftzug (G blau, o rot, o gelb, g blau,
 * l grün, e rot) — sofort als Google erkennbar, ohne das offizielle Logo-Asset
 * einzubetten (Markenrichtlinien). Rein dekorativ; der lesbare Button-Text steht
 * daneben (`aria-hidden`).
 */
function GoogleWordmark() {
  const letters: [string, string][] = [
    ["G", "#4285F4"],
    ["o", "#EA4335"],
    ["o", "#FBBC05"],
    ["g", "#4285F4"],
    ["l", "#34A853"],
    ["e", "#EA4335"],
  ];
  return (
    <span className="booklet-google" aria-hidden>
      {letters.map(([ch, color], i) => (
        <span key={i} style={{ color }}>
          {ch}
        </span>
      ))}
    </span>
  );
}
