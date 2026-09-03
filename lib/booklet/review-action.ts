import { trackBookletEvent } from "./track";
import { writeToClipboard } from "@/lib/share/clipboard";

/**
 * Gemeinsame Bewertungs-Aktion der öffentlichen Web-Story.
 *
 * Genutzt vom Bewertungs-POPUP auf der letzten Seite (review-popup.tsx) UND vom
 * sticky „Auf Google bewerten"-Button auf den Medien-Seiten
 * (review-sticky-button.tsx) — bewusst EINE Quelle: beide Einstiege müssen sich
 * identisch verhalten, sonst driften Tracking und die §8.6-Zusagen auseinander.
 *
 * §8.6-PFLICHT (Google-ToS):
 * - Der Entwurf ist ein VORSCHLAG, im Google-Feld frei anpassbar; NIEMALS an
 *   eine Belohnung gekoppelt.
 * - Kein Gating nach Zufriedenheit: der Link ist immer derselbe, das Tracking
 *   unterscheidet nicht (ein `link_click/review` pro Klick, ohne Sternezahl).
 *
 * REIHENFOLGE ist Absicht (unverändert aus dem Popup übernommen): erst das
 * Event, dann der Entwurf in die Zwischenablage — solange das Dokument noch
 * fokussiert ist — und ERST DANN das Google-Profil im neuen Tab. Umgekehrt
 * verlöre die Seite den Fokus, bevor das Kopieren durch ist.
 *
 * SSR-sicher: `window` wird ausschließlich im Funktionskörper berührt.
 *
 * Rückgabe: ob der Entwurf tatsächlich in der Zwischenablage gelandet ist
 * (nur dann darf die Oberfläche „kopiert" behaupten).
 */
export async function submitGoogleReview({
  token,
  reviewDraft,
  googleReviewUrl,
}: {
  token: string;
  reviewDraft: string | null;
  googleReviewUrl: string;
}): Promise<boolean> {
  trackBookletEvent(token, "link_click", "review");
  const copied = reviewDraft ? await writeToClipboard(reviewDraft) : false;
  window.open(reviewHref(googleReviewUrl), "_blank", "noopener,noreferrer");
  return copied;
}

/** Externer Link bekommt ein Protokoll, falls der Betrieb keins gesetzt hat. */
export function reviewHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}
