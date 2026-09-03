"use client";

import { useEffect, useRef, useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import { trackBookletEvent } from "@/lib/booklet/track";
import { writeToClipboard } from "@/lib/share/clipboard";
import {
  canShareFiles as detectCanShareFiles,
  downloadFile,
  fetchAsShareFile,
  shareFile,
} from "@/lib/share/file-share";

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
 *
 * Die Google-Bewertung sitzt NICHT mehr hier: sie läuft über das Bewertungs-
 * Popup (review-popup.tsx), das auf dieser Seite nach kurzer Verweildauer
 * aufgeht — §8.6-Leitplanken dort dokumentiert.
 *
 * Hinweis: WhatsApp / „Link kopieren" / IG-Caption sind aus der UI entfernt;
 * die Event-Taxonomie (whatsapp/copy/ig in lib/booklet/events.ts) bleibt
 * unverändert gültig — nur die Buttons feuern sie nicht mehr.
 */
export function ShareBar({
  token,
  storyUrl,
  reelSignedUrl,
  locale,
}: {
  token: string;
  storyUrl: string;
  reelSignedUrl: string | null;
  locale: Locale;
}) {
  const [copied, setCopied] = useState(false);
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
    const canShare = detectCanShareFiles();
    setCanShareFiles(canShare);

    // Prefetch nur, wenn ein Reel vorliegt UND Datei-Sharing möglich ist
    // (sonst greift der Download-Fallback, der die URL direkt nutzt).
    if (!reelSignedUrl || !canShare) return;
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const file = await fetchAsShareFile(
          reelSignedUrl,
          "reel.mp4",
          "video/mp4",
          controller.signal,
        );
        if (cancelled) return;
        reelFileRef.current = file;
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

  function flashCopied() {
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  /** Story-URL kopieren (Fallback von „Booklet teilen"); nur bei Erfolg flashen. */
  function copyLink() {
    void (async () => {
      if (await writeToClipboard(storyUrl)) flashCopied();
      // Schlägt selbst der Legacy-Fallback fehl (sehr selten), kein Fehler-Toast.
    })();
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
      void shareFile(file, t(locale, "share.shareTitle"));
      return;
    }
    // Keine teilbare Datei (kein File-Sharing / Prefetch verworfen) → Download.
    downloadFile(reelSignedUrl, "reel.mp4");
  }

  // Datei-Share-Pfad, aber Prefetch noch nicht fertig → Button disabled/Ladezustand.
  const reelLoading = canShareFiles && !reelReady;

  return (
    <div className="booklet-share booklet-frost">
      <p className="booklet-share-heading">{t(locale, "share.heading")}</p>

      <Pressable className="booklet-share-primary" onPress={handleShareBooklet}>
        <ShareIcon />
        <span>
          {copied ? t(locale, "share.copied") : t(locale, "share.shareBooklet")}
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
    </div>
  );
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

