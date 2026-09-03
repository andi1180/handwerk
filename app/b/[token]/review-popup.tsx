"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import { submitGoogleReview } from "@/lib/booklet/review-action";
import { GoogleWordmark } from "./google-wordmark";

/**
 * Bewertungs-Popup auf der letzten Booklet-Seite (Outro) — ersetzt den früheren
 * „Google-Bewertung schreiben"-Button in der Teilen-Sektion.
 *
 * AUSLÖSUNG: ein unsichtbarer Marker (Sentinel) im Outro wird von einem
 * IntersectionObserver mit `root = .booklet-scroll` beobachtet — dasselbe
 * Sichtbarkeits-Muster wie das Video-Autoplay (booklet-video.tsx), damit sich
 * beide im Scroll-Snap-Container gleich verhalten. Ist der Marker sichtbar,
 * öffnet das Popup nach 1 s Verweildauer; wird vorher weggescrollt, verfällt
 * der Timer. Das Popup erscheint pro Seitenaufruf HÖCHSTENS EINMAL — einmal
 * geschlossen (Abbrechen / Tap auf den Hintergrund / Escape), bleibt es zu.
 *
 * §8.6-PFLICHT (Google-ToS):
 * - Die im Popup gewählte Sternezahl wird NICHT an Google übergeben. Google hat
 *   die URL-Vorbefüllung von Bewertungen unterbunden; es gibt keinen
 *   zuverlässigen Weg dafür. Der Link öffnet die normale Bewertungsseite, der
 *   Nutzer vergibt die Sterne dort selbst.
 * - Das Verhalten ist bei JEDER Sternezahl IDENTISCH (kein Gating, keine
 *   Verzweigung nach Zufriedenheit) — 1 Stern öffnet exakt denselben Link wie
 *   5 Sterne. Auch das Tracking unterscheidet nicht nach Sternezahl.
 * - Der Textentwurf bleibt ein VORSCHLAG (im Google-Feld frei anpassbar) und ist
 *   NIEMALS an eine Belohnung gekoppelt.
 *
 * SSR-sicher: `window`/`navigator`/`document` nur in Handlern/Effects.
 */

/** Ab diesem Sichtbarkeits-Anteil gilt der Marker als „im Bild". */
const VISIBLE_RATIO = 0.5;
/** Verweildauer auf der letzten Seite, bevor das Popup aufgeht. */
const OPEN_DELAY_MS = 1000;

export function ReviewPopup({
  token,
  reviewDraft,
  googleReviewUrl,
  locale,
}: {
  token: string;
  reviewDraft: string | null;
  googleReviewUrl: string | null;
  locale: Locale;
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  /** Höchstens einmal pro Seitenaufruf zeigen. */
  const shownRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [copied, setCopied] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  /* Sichtbarkeit des Markers → nach OPEN_DELAY_MS öffnen (einmalig). */
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const root = sentinel.closest(".booklet-scroll");
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO) {
            if (shownRef.current || timer) continue;
            timer = setTimeout(() => {
              timer = null;
              if (shownRef.current) return;
              shownRef.current = true;
              setOpen(true);
              observer.disconnect();
            }, OPEN_DELAY_MS);
          } else {
            // Vor Ablauf weggescrollt ⇒ Timer verfällt.
            clear();
          }
        }
      },
      { root, threshold: [0, VISIBLE_RATIO, 1] },
    );
    observer.observe(sentinel);
    return () => {
      clear();
      observer.disconnect();
    };
  }, []);

  /* Escape schließt (wie der Tap auf den Hintergrund). */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  /**
   * „Bewertung abgeben" — IDENTISCH für jede Sternezahl (§8.6, kein Gating).
   * Aktion, Tracking (ein `link_click/review` ohne Sternezahl) und die
   * Reihenfolge Kopieren-vor-Öffnen liegen in `submitGoogleReview` — geteilt
   * mit dem sticky Bewertungs-Button der Medien-Seiten.
   */
  async function submit() {
    if (!googleReviewUrl) return;
    if (await submitGoogleReview({ token, reviewDraft, googleReviewUrl })) {
      setCopied(true);
    }
    close();
  }

  return (
    <>
      {/* Unsichtbarer Auslöser-Marker im Outro (kein Layout-Einfluss). */}
      <div className="booklet-review-sentinel" ref={sentinelRef} aria-hidden />

      {open ? (
        <div
          className="booklet-review-backdrop"
          role="presentation"
          onClick={close}
        >
          <div
            className="booklet-review-popup booklet-frost"
            role="dialog"
            aria-modal="true"
            aria-label={t(locale, "review.dialogLabel")}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Google-Wortmarke — exakt der Marker des früheren Buttons. */}
            <GoogleWordmark className="booklet-review-brand" />

            <div
              className="booklet-review-stars"
              role="radiogroup"
              aria-label={t(locale, "review.starsLabel")}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className="booklet-star"
                  role="radio"
                  aria-checked={rating === value}
                  aria-label={t(locale, "review.starLabel", { n: String(value) })}
                  onClick={() => setRating(value)}
                >
                  <StarIcon filled={value <= rating} />
                </button>
              ))}
            </div>

            <p className="booklet-review-emotional">{t(locale, "review.emotional")}</p>

            <button
              type="button"
              className="booklet-review-submit"
              onClick={() => void submit()}
            >
              {copied ? t(locale, "review.copied") : t(locale, "review.submit")}
            </button>

            {/* §8.6: Vorschlag-Charakter (Textvorschlag/KI), im Google-Feld frei
                editierbar; kein Belohnungsbezug, keine Sterne-Vorgabe. */}
            {reviewDraft ? (
              <p className="booklet-review-hint">{t(locale, "review.hint")}</p>
            ) : null}

            <span
              className="booklet-review-cancel"
              role="button"
              tabIndex={0}
              onClick={close}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  close();
                }
              }}
            >
              {t(locale, "review.cancel")}
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
}

/* --- Icons (dekorativ) --- */

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width={34}
      height={34}
      viewBox="0 0 24 24"
      fill={filled ? "#FBBC05" : "none"}
      stroke={filled ? "#FBBC05" : "currentColor"}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.77l-5.2 2.73.99-5.78-4.21-4.1 5.82-.85z" />
    </svg>
  );
}
