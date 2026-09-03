"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import { submitGoogleReview } from "@/lib/booklet/review-action";
import { GoogleWordmark } from "./google-wordmark";

/**
 * Sticky „Auf Google bewerten"-Button auf den MEDIEN-Seiten der Web-Story.
 *
 * SICHTBARKEIT — genau Seite 2 bis vorletzte Seite:
 * Ein IntersectionObserver mit `root = .booklet-scroll` beobachtet alle
 * `.booklet-section--media`-Sektionen — dasselbe Sichtbarkeits-Muster wie
 * Video-Autoplay (booklet-video.tsx) und Bewertungs-Popup (review-popup.tsx),
 * damit sich alles im Scroll-Snap-Container gleich verhält. Sichtbar ist der
 * Button genau dann, wenn eine Medien-Sektion zu mindestens VISIBLE_RATIO im
 * Bild liegt. Intro (erste Seite) und Outro (letzte Seite) tragen die Klasse
 * nicht ⇒ dort erscheint er nie: vorne wäre er aufdringlich, hinten übernimmt
 * das Popup. Der Button selbst ist `position: fixed` — er läuft also über die
 * Medien-Seiten hinweg mit, statt pro Seite neu ein-/auszublenden.
 *
 * Er hängt bewusst NICHT im Scroller, sondern als Geschwister daneben: ein
 * Element INNERHALB einer 100dvh-Snap-Sektion könnte gar nicht „mitlaufen".
 *
 * Oben mittig (nicht unten), damit der Scroll-Hinweis auf die nächste Seite
 * frei bleibt. Liegt eine Seite ein Logo oben mittig ab (`logo_per_page`),
 * rutscht der Button darunter (`belowPageLogo`).
 *
 * §8.6 (Google-ToS): Aktion, Tracking und Vorschlag-Charakter kommen aus
 * `submitGoogleReview` — identisch zum Popup, kein Gating, keine Belohnung.
 *
 * Gerendert wird er nur in der Kunden-Sicht (`?c=1`) und nur, wenn eine
 * Google-Review-URL hinterlegt ist (Gate in page.tsx, wie beim Popup).
 *
 * SSR-sicher: `document`/`window` nur in Effects/Handlern.
 */

/** Ab diesem Sichtbarkeits-Anteil gilt eine Medien-Seite als „im Bild". */
const VISIBLE_RATIO = 0.5;
/** Wie lange die „kopiert"-Rückmeldung am Button stehen bleibt. */
const COPIED_RESET_MS = 2500;

export function ReviewStickyButton({
  token,
  reviewDraft,
  googleReviewUrl,
  locale,
  belowPageLogo,
}: {
  token: string;
  reviewDraft: string | null;
  googleReviewUrl: string;
  locale: Locale;
  belowPageLogo: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Sichtbarkeit: an mindestens einer Medien-Sektion im Bild gekoppelt. */
  useEffect(() => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>(".booklet-section--media"),
    );
    // Booklet ohne Medien (nur Intro + Outro) ⇒ nichts zu beobachten.
    if (sections.length === 0) return;
    const root = document.querySelector(".booklet-scroll");
    const inView = new Set<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO) {
            inView.add(entry.target);
          } else {
            inView.delete(entry.target);
          }
        }
        setVisible(inView.size > 0);
      },
      { root, threshold: [0, VISIBLE_RATIO, 1] },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  /* Timer der „kopiert"-Rückmeldung beim Unmount räumen. */
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const submit = useCallback(async () => {
    const didCopy = await submitGoogleReview({
      token,
      reviewDraft,
      googleReviewUrl,
    });
    // „kopiert" nur behaupten, wenn es wirklich geklappt hat.
    if (!didCopy) return;
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  }, [token, reviewDraft, googleReviewUrl]);

  return (
    <button
      type="button"
      className={
        belowPageLogo
          ? "booklet-review-sticky booklet-review-sticky--below-logo"
          : "booklet-review-sticky"
      }
      // Unsichtbar heißt auch: nicht anklickbar und nicht in der Tab-Reihenfolge
      // (das Element bleibt für den weichen Übergang montiert).
      data-visible={visible ? "true" : "false"}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      aria-label={t(locale, "review.stickyAria")}
      onClick={() => void submit()}
    >
      {copied ? (
        <span>{t(locale, "review.copied")}</span>
      ) : (
        <>
          <GoogleWordmark />
          <span>{t(locale, "review.stickyLabel")}</span>
        </>
      )}
    </button>
  );
}
