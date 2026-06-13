"use client";

import { useEffect, useRef, useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import { trackBookletEvent } from "@/lib/booklet/track";

/** Welcher „✓ kopiert"-Flash gerade aktiv ist (immer nur einer). */
type CopiedKey = "link" | "ig" | "review";

/**
 * Teilen-Sektion der öffentlichen Web-Story — der WOM-Kern.
 *
 * SSR-sicher: `window`/`navigator` werden ausschließlich in Handlern/Effects
 * berührt, nie beim Render. Buttons sind `div + onClick` (kein `<form>`).
 *
 * Reihenfolge: Reel teilen (Datei, 9a) → IG-Caption-Vorschlag (9b, nahe „Reel
 * teilen") → Story teilen (URL, 9a) → WhatsApp (9a) → Link kopieren (9a) →
 * Google-Bewertung (9b, darunter).
 *
 * - „Reel teilen": Reel-Blob holen → File → `navigator.share({ files })` (öffnet
 *   den IG/TikTok-Composer). Geht das nicht, Fallback = Download. Nur sichtbar,
 *   wenn ein fertiges Reel vorliegt (`reelSignedUrl` gesetzt).
 * - IG-Caption (9b): nur wenn `igCaption` vorhanden — der Kunde kopiert sie für
 *   den IG-Post (der @-Handle des Betriebs ist der Tagging-Multiplikator).
 * - „Story teilen": `navigator.share({ url })`, Fallback = Link kopieren.
 * - „WhatsApp": Deeplink `https://wa.me/?text=…`.
 * - „Link kopieren": Clipboard + kurzer „✓ Link kopiert"-Flash.
 * - „Google-Bewertung schreiben" (9b): nur wenn `googleReviewUrl` UND `reviewDraft`
 *   vorhanden. Klick → Entwurf in die Zwischenablage + Deeplink zum Google-Profil.
 *   §8.6-PFLICHT: Framing „Vorschlag, gern in deinen Worten anpassen" (NICHT „Text
 *   einfügen"), und NIEMALS an eine Belohnung gekoppelt (harter Google-ToS-Verstoß).
 */
export function ShareBar({
  token,
  storyUrl,
  reelSignedUrl,
  reviewDraft,
  googleReviewUrl,
  igCaption,
  locale,
}: {
  token: string;
  storyUrl: string;
  reelSignedUrl: string | null;
  reviewDraft: string | null;
  googleReviewUrl: string | null;
  igCaption: string | null;
  locale: Locale;
}) {
  const [copiedKey, setCopiedKey] = useState<CopiedKey | null>(null);
  const [reelBusy, setReelBusy] = useState(false);
  // Optimistisch: die Zielgruppe (Kunde am Handy) kann i. d. R. Dateien teilen.
  // Nach dem Mount per Capability-Probe ggf. auf „Herunterladen" korrigiert.
  const [canShareFiles, setCanShareFiles] = useState(true);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const probe = new File([new Blob([], { type: "video/mp4" })], "probe.mp4", {
        type: "video/mp4",
      });
      setCanShareFiles(
        typeof navigator.canShare === "function" &&
          navigator.canShare({ files: [probe] }),
      );
    } catch {
      setCanShareFiles(false);
    }
  }, []);

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

  /** Text in die Zwischenablage + Flash; Verweigerung (z. B. ohne HTTPS) still ignorieren. */
  async function copyText(text: string, key: CopiedKey): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(key);
    } catch {
      // Clipboard nicht verfügbar — kein Fehler-Toast.
    }
  }

  /** Pures Kopieren der Story-URL (auch Fallback von „Story teilen"). */
  function copyLink() {
    void copyText(storyUrl, "link");
  }

  /** Button „Link kopieren": Event (shared/copy) + Kopieren. */
  function handleCopyLink() {
    trackBookletEvent(token, "shared", "copy");
    copyLink();
  }

  function copyIgCaption() {
    if (!igCaption) return;
    // IG-Caption kopiert = link_click/ig (der @-Handle ist der Tagging-Multiplikator).
    trackBookletEvent(token, "link_click", "ig");
    void copyText(igCaption, "ig");
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

  async function handleShareReel() {
    if (!reelSignedUrl || reelBusy) return;
    // Reel teilen/Download zählt als shared/reel (Intent, unabhängig vom Pfad).
    trackBookletEvent(token, "shared", "reel");
    setReelBusy(true);
    try {
      const res = await fetch(reelSignedUrl);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], "reel.mp4", { type: "video/mp4" });

      if (
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] }) &&
        typeof navigator.share === "function"
      ) {
        try {
          await navigator.share({ files: [file], title: t(locale, "share.shareTitle") });
        } catch {
          // Abbruch durch den Nutzer ist kein Fehler — kein Toast, kein Download.
        }
      } else {
        downloadReel(reelSignedUrl);
      }
    } catch {
      // Blob-Fetch fehlgeschlagen (Netz/CORS) → Download-Fallback.
      downloadReel(reelSignedUrl);
    } finally {
      setReelBusy(false);
    }
  }

  async function handleShareStory() {
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

  function handleWhatsApp() {
    trackBookletEvent(token, "shared", "whatsapp");
    const text = `${t(locale, "share.message")} ${storyUrl}`;
    const href = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(href, "_blank", "noopener,noreferrer");
  }

  const showReview = Boolean(googleReviewUrl && reviewDraft);

  return (
    <div className="booklet-share booklet-frost">
      <p className="booklet-share-heading">{t(locale, "share.heading")}</p>

      {reelSignedUrl ? (
        <Pressable
          className="booklet-share-primary"
          onPress={handleShareReel}
          disabled={reelBusy}
        >
          <ShareIcon />
          <span>
            {reelBusy
              ? t(locale, "share.sharing")
              : canShareFiles
                ? t(locale, "share.shareReel")
                : t(locale, "share.download")}
          </span>
        </Pressable>
      ) : null}

      {igCaption ? (
        <div className="booklet-ig">
          <div className="booklet-ig-head">
            <InstagramIcon />
            <span>{t(locale, "igCaption.label")}</span>
          </div>
          <p className="booklet-ig-text">{igCaption}</p>
          <Pressable className="booklet-ig-copy" onPress={copyIgCaption}>
            <CopyIcon />
            <span>
              {copiedKey === "ig"
                ? t(locale, "igCaption.copied")
                : t(locale, "igCaption.copy")}
            </span>
          </Pressable>
        </div>
      ) : null}

      <div className="booklet-share-row">
        <Pressable className="booklet-share-btn" onPress={handleShareStory}>
          <SendIcon />
          <span>{t(locale, "share.shareStory")}</span>
        </Pressable>
        <Pressable className="booklet-share-btn" onPress={handleWhatsApp}>
          <WhatsAppIcon />
          <span>{t(locale, "share.whatsapp")}</span>
        </Pressable>
        <Pressable className="booklet-share-btn" onPress={handleCopyLink}>
          <LinkIcon />
          <span>{copiedKey === "link" ? t(locale, "share.copied") : t(locale, "share.copyLink")}</span>
        </Pressable>
      </div>

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
          {/* §8.6: „Vorschlag, in deinen Worten" — NICHT „Text einfügen". Kein Belohnungs-Hinweis. */}
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

function SendIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.86 9.86 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 1.67c2.2 0 4.27.86 5.83 2.42a8.2 8.2 0 0 1 2.42 5.82c0 4.54-3.7 8.24-8.25 8.24a8.2 8.2 0 0 1-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.18 8.18 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24zm-3.2 4.43c-.15 0-.4.06-.6.29-.21.23-.8.78-.8 1.9 0 1.12.82 2.2.93 2.36.11.15 1.6 2.45 3.93 3.43.55.24.98.38 1.31.49.55.17 1.06.15 1.46.09.44-.07 1.37-.56 1.56-1.1.19-.54.19-1 .14-1.1-.06-.09-.21-.15-.44-.27-.23-.11-1.37-.68-1.58-.75-.21-.08-.37-.11-.52.11-.15.23-.59.75-.73.9-.13.15-.27.17-.5.06-.23-.12-.97-.36-1.85-1.14-.68-.61-1.14-1.36-1.28-1.59-.13-.23-.01-.35.1-.46.1-.1.23-.27.34-.4.12-.14.15-.23.23-.38.08-.15.04-.29-.02-.4-.06-.12-.52-1.26-.71-1.72-.19-.45-.38-.39-.52-.4-.13-.01-.29-.01-.44-.01z" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.32-1.32" />
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

function CopyIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
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
