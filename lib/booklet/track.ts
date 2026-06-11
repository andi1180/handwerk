import { hasNoTrackMarker } from "./events";
import type { BookletEventType, BookletEventChannel } from "./events";

/**
 * Fire-and-forget Event-POST an den öffentlichen Endpoint (Schritt 10a).
 *
 * Der `token` kommt aus dem URL-Pfad (die Seite kennt ihn) — NIE eine
 * `business_id` im Client. Der Aufruf ist bewusst NICHT awaitable und schluckt
 * jeden Fehler: ein Analytics-Aussetzer darf die Kunden-UI nie stören.
 *
 * `keepalive` lässt den Request überleben, wenn der Tap die Seite verlässt
 * (Share-Sheet, WhatsApp-Deeplink, neuer Tab).
 *
 * No-Track (Schritt 10a.1): steht der `p=1`-Marker in der aktuellen URL (ein
 * betriebs-eigener Aufruf), wird HIER zentral abgebrochen — kein Request, kein
 * Status-Vorrücken. Zentral in `trackBookletEvent`, damit kein Aufrufer
 * (view-tracker / share-bar / tracked-link) den Check vergessen kann.
 */
export function trackBookletEvent(
  token: string,
  eventType: BookletEventType,
  channel: BookletEventChannel | null = null,
): void {
  if (typeof window !== "undefined" && hasNoTrackMarker(window.location.search)) {
    return;
  }
  try {
    void fetch(`/api/b/${encodeURIComponent(token)}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: eventType, channel }),
      keepalive: true,
    }).catch(() => {
      // Analytics ist best-effort — Fehler still verschlucken.
    });
  } catch {
    // niemals werfen
  }
}
