/**
 * Werte der Status-Dropdown-Achse (`?status=`). Der DB-Status `draft` wird für
 * Anzeige UND Filterung in **zwei abgeleitete** Zustände gesplittet (KEIN neuer
 * `orders.status`-Wert, keine Migration — reine Präsentations-/Filter-Ableitung
 * aus `status='draft'` + Medien-Existenz):
 *
 *  - `new`         → `status='draft'` UND KEIN `order_media`  („Neu").
 *  - `in_progress` → `status='draft'` UND ≥1 `order_media`    („In Arbeit").
 *
 * Analog dazu wird der DB-Status `generated` für Anzeige UND Filterung in **drei**
 * abgeleitete Render-Zustände gesplittet (ebenfalls KEIN neuer `orders.status`-Wert)
 * — angeglichen an das zusammengesetzte Listen-Badge (Schritt C), das für
 * `generated` aus `booklets.reel_status` „Wird erstellt / Fertig / Fehler" zeigt:
 *
 *  - `creating` → `status='generated'` UND `reel_status ∈ {pending, rendering}`.
 *  - `ready`    → `status='generated'` UND `reel_status = 'ready'`.
 *  - `failed`   → `status='generated'` UND `reel_status = 'failed'`.
 *
 * Die drei decken den gesamten `generated`-Raum ab (`reel_status` ist NOT NULL).
 * Server-seitig per `booklets!inner(reel_status)`-Einbettung übersetzt (1:1 zu
 * `orders` ⇒ kein count-Aufblähen) — siehe `buildFilteredOrdersQuery`.
 *
 * Die übrigen Werte sind echte `OrderStatus` (`sent`/`viewed`/`shared`) und
 * werden direkt auf `status=<wert>` übersetzt. Die Server-seitige Übersetzung
 * passiert in der Auftragsliste — die Medien-/Reel-Bedingung muss dort IN die
 * Query (sonst bricht die Pagination).
 */
export const STATUS_FILTERS = [
  "new",
  "in_progress",
  "creating",
  "ready",
  "failed",
  "sent",
  "viewed",
  "shared",
] as const;

export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** Typ-Guard: ist der String ein gültiger Status-Filter-Wert? */
export function isStatusFilter(value: unknown): value is StatusFilter {
  return (
    typeof value === "string" &&
    (STATUS_FILTERS as readonly string[]).includes(value)
  );
}

/**
 * Quick-Filter der Auftragsliste (Block C / Schritt 3). Eigene Achse **neben**
 * dem Status-Dropdown (`?status=`) — sie deckt Sonderbedingungen ab, die kein
 * einzelner Status-Wert ausdrückt, und läuft daher über einen eigenen
 * Query-Parameter `?quick=`. Dropdown und Quick schließen sich gegenseitig aus
 * (immer nur einer führt).
 *
 *  - `flagged` → „Abgeholt, Booklet nicht versendet" (exakt die Warn-Badge-
 *                Bedingung aus Block C / Schritt 2): `picked_up_at` gesetzt UND
 *                Status ∈ {draft, generated} (= NOT IN {sent, viewed, shared};
 *                `finalized` existiert nicht mehr).
 *
 * Der frühere Quick-Filter `drafts` (Status === 'draft') ist mit dem
 * Entwurfs-Split der Status-Dropdown-Achse (Neu / In Arbeit) redundant geworden
 * und daher entfernt.
 */
export const QUICK_FILTERS = ["flagged"] as const;

export type QuickFilter = (typeof QUICK_FILTERS)[number];

/** Typ-Guard: ist der String ein gültiger Quick-Filter? */
export function isQuickFilter(value: unknown): value is QuickFilter {
  return (
    typeof value === "string" &&
    (QUICK_FILTERS as readonly string[]).includes(value)
  );
}

/** Seitengröße der server-seitig paginierten Auftragsliste. */
export const ORDERS_PAGE_SIZE = 20;

/**
 * Baut die Auftragslisten-URL aus dem aktiven Filter + Seite. **Eine Quelle**
 * für die Pagination-Links (`OrdersPagination`) und den Overshoot-Redirect der
 * Seite. Quick hat Vorrang vor Status (sie schließen sich ohnehin aus); `page`
 * wird nur ab Seite 2 angehängt (Seite 1 = nackte URL). `archived=true` schaltet
 * in den Archiv-Scope (`?archived=1`). `q` (Freitext-Suche, Schritt B) ist
 * **unabhängig** von status/quick (deren Exklusivität bleibt); leer ⇒ kein `q`.
 */
export function buildOrdersUrl(opts: {
  status?: StatusFilter | null;
  quick?: QuickFilter | null;
  page?: number;
  archived?: boolean;
  q?: string | null;
}): string {
  const params = new URLSearchParams();
  if (opts.archived) params.set("archived", "1");
  if (opts.quick) params.set("quick", opts.quick);
  else if (opts.status) params.set("status", opts.status);
  if (opts.q) params.set("q", opts.q);
  if (opts.page && opts.page > 1) params.set("page", String(opts.page));
  const qs = params.toString();
  return qs ? `/portal/orders?${qs}` : "/portal/orders";
}
