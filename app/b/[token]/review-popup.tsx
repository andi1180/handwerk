"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import { submitGoogleReview } from "@/lib/booklet/review-action";
import { GoogleWordmark } from "./google-wordmark";

/**
 * Bewertungs-SHEET auf der letzten Booklet-Seite (Outro) — ersetzt den früheren
 * „Google-Bewertung schreiben"-Button in der Teilen-Sektion.
 *
 * AUSLÖSUNG (unverändert): ein unsichtbarer Marker (Sentinel) im Outro wird von
 * einem IntersectionObserver mit `root = .booklet-scroll` beobachtet — dasselbe
 * Sichtbarkeits-Muster wie das Video-Autoplay (booklet-video.tsx), damit sich
 * beide im Scroll-Snap-Container gleich verhalten. Ist der Marker sichtbar,
 * fährt das Sheet nach 1 s Verweildauer von unten herein; wird vorher
 * weggescrollt, verfällt der Timer. Der AUTOMATISCHE Trigger feuert pro
 * Seitenaufruf HÖCHSTENS EINMAL.
 *
 * DREI ZUSTÄNDE — es verschwindet nie ganz:
 * - `hidden`     … vor dem Auslösen (montiert, aber unter dem unteren Rand).
 * - `open`       … volles Sheet: Wortmarke, 5 Sterne, Satz, „Bewertung abgeben",
 *                  „Abbrechen".
 * - `minimized`  … schmale Leiste unten mit den 5 Sternen (im aktuellen
 *                  Auswahlzustand) + Hinweis. Antippen klappt wieder auf; wird
 *                  dabei direkt ein Stern getroffen, ist diese Sternezahl im
 *                  aufgeklappten Sheet schon vorausgewählt (kein Reset).
 * Der Minimieren-/Wieder-Öffnen-Zyklus ist beliebig oft möglich, ohne dass der
 * 1-s-Auto-Trigger erneut feuert.
 *
 * MINIMIEREN statt Schließen löst aus: „Abbrechen", Escape UND jeder Klick
 * außerhalb des Sheets. Letzteres deckt bewusst auch die Teilen-Buttons und die
 * Kontakt-Links ab: der Listener hängt am Dokument (pointerdown, capture) und
 * greift NICHT ein — er ruft weder `preventDefault` noch `stopPropagation` —
 * die eigentliche Aktion läuft also ganz normal, das Sheet minimiert zusätzlich.
 * Deshalb ist der abdunkelnde Hintergrund rein optisch (`pointer-events: none`)
 * und blockiert nichts; im minimierten Zustand ist er ganz weg.
 *
 * §8.6-PFLICHT (Google-ToS):
 * - Die gewählte Sternezahl wird NICHT an Google übergeben. Google hat die
 *   URL-Vorbefüllung von Bewertungen unterbunden; es gibt keinen zuverlässigen
 *   Weg dafür. Der Link öffnet die normale Bewertungsseite, der Nutzer vergibt
 *   die Sterne dort selbst.
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
/** Verweildauer auf der letzten Seite, bevor das Sheet aufgeht. */
const OPEN_DELAY_MS = 1000;

type SheetState = "hidden" | "open" | "minimized";

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
  const sheetRef = useRef<HTMLDivElement | null>(null);
  /** Der AUTOMATISCHE Trigger feuert höchstens einmal pro Seitenaufruf. */
  const autoShownRef = useRef(false);
  const [state, setState] = useState<SheetState>("hidden");
  const [rating, setRating] = useState(0);
  const [copied, setCopied] = useState(false);

  const minimize = useCallback(() => setState("minimized"), []);
  const expand = useCallback(() => setState("open"), []);

  /* Sichtbarkeit des Markers → nach OPEN_DELAY_MS aufklappen (einmalig). */
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
            if (autoShownRef.current || timer) continue;
            timer = setTimeout(() => {
              timer = null;
              if (autoShownRef.current) return;
              autoShownRef.current = true;
              setState("open");
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

  /* Escape minimiert (wie „Abbrechen"). */
  useEffect(() => {
    if (state !== "open") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") minimize();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, minimize]);

  /* Jeder Klick/Tap AUSSERHALB des Sheets minimiert — Hintergrund, Teilen-
     Buttons, Kontakt-Links. Der Listener beobachtet nur (capture, kein
     preventDefault/stopPropagation), die getroffene Aktion läuft normal weiter. */
  useEffect(() => {
    if (state !== "open") return;
    const onPointerDown = (e: PointerEvent) => {
      const sheet = sheetRef.current;
      const target = e.target;
      if (sheet && target instanceof Node && sheet.contains(target)) return;
      minimize();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [state, minimize]);

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
    minimize();
  }

  /** Tap auf einen Stern der minimierten Leiste: übernehmen + aufklappen. */
  function pickFromBar(value: number) {
    setRating(value);
    expand();
  }

  return (
    <>
      {/* Unsichtbarer Auslöser-Marker im Outro (kein Layout-Einfluss). */}
      <div className="booklet-review-sentinel" ref={sentinelRef} aria-hidden />

      {/* Nur optische Abdunklung — blockiert KEINE Klicks (pointer-events: none),
          damit Teilen-Buttons/Kontakt-Links normal bedienbar bleiben. */}
      <div
        className="booklet-review-backdrop"
        data-open={state === "open" ? "true" : "false"}
        aria-hidden
      />

      <div
        className="booklet-review-sheet"
        data-state={state}
        ref={sheetRef}
        aria-hidden={state === "hidden"}
      >
        {state === "open" ? (
          <div
            className="booklet-review-panel booklet-frost"
            role="dialog"
            aria-label={t(locale, "review.dialogLabel")}
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
                  <StarIcon filled={value <= rating} size={34} />
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

            {/* „Abbrechen" schließt nicht, es minimiert zur unteren Leiste. */}
            <span
              className="booklet-review-cancel"
              role="button"
              tabIndex={0}
              onClick={minimize}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  minimize();
                }
              }}
            >
              {t(locale, "review.cancel")}
            </span>
          </div>
        ) : (
          <div
            className="booklet-review-bar booklet-frost"
            role="button"
            tabIndex={state === "hidden" ? -1 : 0}
            aria-label={t(locale, "review.minimizedAria")}
            onClick={expand}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                expand();
              }
            }}
          >
            <div className="booklet-review-bar-stars" aria-hidden>
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className="booklet-star"
                  tabIndex={-1}
                  aria-label={t(locale, "review.starLabel", { n: String(value) })}
                  onClick={(e) => {
                    // Der Stern übernimmt den Tap (die Leiste klappt trotzdem auf).
                    e.stopPropagation();
                    pickFromBar(value);
                  }}
                >
                  <StarIcon filled={value <= rating} size={26} />
                </button>
              ))}
            </div>
            <span className="booklet-review-bar-hint">
              <ChevronUpIcon />
              {copied ? t(locale, "review.copied") : t(locale, "review.minimizedHint")}
            </span>
          </div>
        )}
      </div>
    </>
  );
}

/* --- Icons (dekorativ) --- */

function StarIcon({ filled, size }: { filled: boolean; size: number }) {
  return (
    <svg
      width={size}
      height={size}
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

/** Pfeil nach oben — Hinweis „aufklappen" in der minimierten Leiste. */
function ChevronUpIcon() {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 15l-6-6-6 6" />
    </svg>
  );
}
