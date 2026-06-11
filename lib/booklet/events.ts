/**
 * Geteilte Event-Taxonomie für Booklet-Analytics (Schritt 10a).
 *
 * PLAIN-Modul — KEIN service_role, KEINE Secrets: damit auch im Client
 * importierbar (`share-bar.tsx`, `track.ts`) für typsichere Event-Konstanten;
 * die Schreib-/Validierungslogik bleibt server-seitig im Event-Endpoint.
 *
 * `event_type` bleibt im 0001-erlaubten Wertebereich (viewed/shared/qr_click/
 * link_click). Wir nutzen davon `viewed`/`shared`/`link_click` — die feinere
 * Spezifik trägt der `channel`:
 *
 *   viewed     / —          → Seite geöffnet
 *   shared     / reel       → Reel teilen/Download
 *   shared     / story      → Story teilen
 *   shared     / whatsapp   → WhatsApp
 *   shared     / copy       → Link kopieren
 *   link_click / website    → Outro-Website-Klick
 *   link_click / review     → Google-Review-Klick
 *   link_click / ig         → IG-Caption kopiert
 */

export const EVENT_TYPES = ["viewed", "shared", "link_click"] as const;
export type BookletEventType = (typeof EVENT_TYPES)[number];

export const EVENT_CHANNELS = [
  "reel",
  "story",
  "whatsapp",
  "copy",
  "website",
  "review",
  "ig",
] as const;
export type BookletEventChannel = (typeof EVENT_CHANNELS)[number];

/**
 * Erlaubte (event_type → channel)-Kombinationen. `null` (= kein channel) ist
 * NUR für `viewed` zulässig. Jede andere Kombination wird serverseitig als 400
 * abgewiesen (kein Write).
 */
const ALLOWED_CHANNELS: Record<
  BookletEventType,
  readonly (BookletEventChannel | null)[]
> = {
  viewed: [null],
  shared: ["reel", "story", "whatsapp", "copy"],
  link_click: ["website", "review", "ig"],
};

/** Geparstes, gültiges Event. */
export type ParsedBookletEvent = {
  eventType: BookletEventType;
  channel: BookletEventChannel | null;
};

/**
 * Validiert eine rohe (event_type, channel)-Kombination gegen die Whitelist.
 * Unbekannter Typ, falscher Channel-Typ oder eine nicht erlaubte Kombination
 * ⇒ `null` (der Endpoint antwortet dann 400, kein Write).
 */
export function parseBookletEvent(
  eventType: unknown,
  channel: unknown,
): ParsedBookletEvent | null {
  if (
    typeof eventType !== "string" ||
    !(EVENT_TYPES as readonly string[]).includes(eventType)
  ) {
    return null;
  }
  const type = eventType as BookletEventType;

  const ch = channel === undefined ? null : channel;
  if (ch !== null && typeof ch !== "string") return null;

  const allowed = ALLOWED_CHANNELS[type];
  if (!allowed.includes(ch as BookletEventChannel | null)) return null;

  return { eventType: type, channel: ch as BookletEventChannel | null };
}

/**
 * No-Track-Marker (Schritt 10a.1): betriebs-eigene Booklet-Aufrufe (Portal-
 * Vorschau, Ausgeliefert-Banner) sollen KEINE Analytics-Events auslösen und den
 * Auftragsstatus (`sent → viewed → shared`) NICHT fälschlich vorrücken.
 *
 * WICHTIG: KEIN Sicherheits-/Auth-Gate (wie der `c=1`-Marker in customer-view).
 * Der `access_token` bleibt der alleinige Zugriffsschutz; dieser Marker schaltet
 * AUSSCHLIESSLICH das clientseitige Tracking ab — ohne Request wird auch nichts
 * vorgerückt. Kein DB-Zugriff hängt daran.
 *
 * Betriebs-Links hängen ihn ZUSÄTZLICH zu `c=1` an (`…?c=1&p=1`); Kunden-Links
 * (E-Mail 9c-1, QR 9c-2) tragen ihn NICHT → werden weiter getrackt. Das ist der
 * ganze Punkt: nur betriebs-eigene Aufrufe sind ausgenommen.
 */
export const NO_TRACK_PARAM = "p";
export const NO_TRACK_VALUE = "1";

/** Query-Fragment für betriebs-eigene (no-track) Links, an `c=1` angehängt. */
export const NO_TRACK_QUERY = `${NO_TRACK_PARAM}=${NO_TRACK_VALUE}`;

/** True, wenn der No-Track-Marker (`p=1`) im Query-String der aktuellen URL steht. */
export function hasNoTrackMarker(search: string): boolean {
  try {
    return new URLSearchParams(search).get(NO_TRACK_PARAM) === NO_TRACK_VALUE;
  } catch {
    return false;
  }
}
