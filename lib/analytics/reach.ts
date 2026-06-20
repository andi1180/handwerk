import type { createClient } from "@/lib/supabase/server";

/** Authentifizierter Server-Supabase-Client (RLS-erzwungen, KEIN service_role). */
type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Sortier-Achsen der Reichweiten-/VIP-Analyse (URL-Param `?sort=`). Quelle der
 * Wahrheit für Dashboard-Seite, Filter-Leiste und CSV-Export. Default
 * `reichweite` (desc). Alle Zahl-Achsen sortieren absteigend; `name` A–Z.
 */
export const REACH_SORTS = [
  "reichweite",
  "oeffnungen",
  "teilen",
  "versanddatum",
  "name",
] as const;
export type ReachSort = (typeof REACH_SORTS)[number];
export const DEFAULT_REACH_SORT: ReachSort = "reichweite";

/** Typ-Guard: ist der String eine gültige Sortier-Achse? */
export function isReachSort(value: unknown): value is ReachSort {
  return (
    typeof value === "string" &&
    (REACH_SORTS as readonly string[]).includes(value)
  );
}

/** Eine Zeile der Reichweiten-Analyse (Tabelle UND CSV — gleiche Reihenfolge). */
export type ReachRow = {
  orderId: string;
  customerName: string;
  email: string | null;
  /** Kunden-Telefon (SMS-Kanal). Im Dashboard Fallback der Kontaktspalte, im CSV eigene Spalte. */
  phone: string | null;
  externalRef: string | null;
  /** short_summary ?? item_description. */
  description: string | null;
  /** Booklet-Versanddatum (booklets.sent_at, ISO) bzw. null. */
  sentAt: string | null;
  /** Reichweite = eindeutige nicht-null ip_hash unter event_type='viewed'. */
  reach: number;
  /** Gesamt-Öffnungen = alle viewed (roh, inkl. null-IP). */
  opens: number;
  /** Teilen-Aktivitäten = alle shared (über alle Kanäle). */
  shares: number;
};

/** Optionaler Datums-/Sortier-Filter (aus den URL-Search-Params). */
export type ReachQuery = {
  /** YYYY-MM-DD oder null (= keine Untergrenze) — wirkt auf event.created_at. */
  from: string | null;
  /** YYYY-MM-DD oder null (= keine Obergrenze, inklusiv) — event.created_at. */
  to: string | null;
  sort: ReachSort;
};

/**
 * Validiert/normalisiert einen YYYY-MM-DD-Datums-Param. Ungültiges Format oder
 * unmöglicher Tag (z. B. 2026-02-31) ⇒ null. Round-trip-Check über `Date`.
 */
export function parseDateParam(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === trimmed ? trimmed : null;
}

const DATE_FMT = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** ISO-Zeitstempel → deutsches Datum (TT.MM.JJJJ); null/ungültig ⇒ "". */
export function formatReachDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : DATE_FMT.format(d);
}

type OrderRow = {
  id: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  external_ref: string | null;
  short_summary: string | null;
  item_description: string | null;
};

type BookletRow = {
  id: string;
  order_id: string;
  sent_at: string | null;
};

type EventRow = {
  booklet_id: string;
  event_type: string;
  ip_hash: string | null;
};

/** Aggregat je Booklet (während der Event-Iteration aufgebaut). */
type Agg = { reach: Set<string>; opens: number; shares: number };

/** YYYY-MM-DD → ISO des Folgetags (00:00 UTC) für die inklusive Obergrenze. */
function nextDayIso(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/** Sortiert die Zeilen nach der Achse (Sekundärschlüssel = Name, deterministisch). */
function sortReachRows(rows: ReachRow[], sort: ReachSort): ReachRow[] {
  const byName = (a: ReachRow, b: ReachRow) =>
    a.customerName.localeCompare(b.customerName, "de");
  const bySentDesc = (a: ReachRow, b: ReachRow) => {
    // null (kein Versanddatum) ans Ende.
    if (a.sentAt === b.sentAt) return 0;
    if (!a.sentAt) return 1;
    if (!b.sentAt) return -1;
    return b.sentAt.localeCompare(a.sentAt);
  };
  rows.sort((a, b) => {
    switch (sort) {
      case "oeffnungen":
        return b.opens - a.opens || byName(a, b);
      case "teilen":
        return b.shares - a.shares || byName(a, b);
      case "versanddatum":
        return bySentDesc(a, b) || byName(a, b);
      case "name":
        return byName(a, b);
      case "reichweite":
      default:
        return b.reach - a.reach || byName(a, b);
    }
  });
  return rows;
}

/**
 * Lädt die Reichweiten-Zeilen — die EINE Quelle für Dashboard-Seite (Top 10)
 * und CSV-Export (volle Liste). KEIN RPC/View: drei Queries + Aggregation in TS,
 * analog zum bestehenden Dashboard. Ausschließlich über den AUTHENTICATED Client
 * (RLS-skopiert) + defensiver `business_id`-Filter; KEIN service_role.
 *
 * Zeilen = orders mit status ∈ {sent,viewed,shared}, die ein Booklet haben
 * (1:1; Booklet liefert booklet_id für die Aggregation + sent_at als
 * Versanddatum). booklet_events im optionalen Datumsbereich (event.created_at,
 * `to` inklusiv) werden je booklet_id aggregiert; Booklets ohne Events ⇒ 0.
 */
export async function loadReachRows(
  supabase: ServerClient,
  businessId: string,
  query: ReachQuery,
): Promise<ReachRow[]> {
  // 1) Ausgelieferte Aufträge (RLS + defensiver business_id-Filter).
  const { data: orderData } = await supabase
    .from("orders")
    .select(
      "id, customer_name, customer_email, customer_phone, external_ref, short_summary, item_description",
    )
    .eq("business_id", businessId)
    .in("status", ["sent", "viewed", "shared"])
    .returns<OrderRow[]>();
  const orders = orderData ?? [];
  if (orders.length === 0) return [];

  // 2) Zugehörige Booklets (1:1 über order_id), auf die ausgelieferten Aufträge
  //    skopiert. RLS + defensiver business_id-Filter.
  const orderIds = orders.map((o) => o.id);
  const { data: bookletData } = await supabase
    .from("booklets")
    .select("id, order_id, sent_at")
    .eq("business_id", businessId)
    .in("order_id", orderIds)
    .returns<BookletRow[]>();
  const bookletByOrder = new Map<string, BookletRow>();
  for (const b of bookletData ?? []) bookletByOrder.set(b.order_id, b);

  // 3) Events im Datumsbereich (RLS + defensiver business_id-Filter). Ohne
  //    Datumsfilter = alle. `to` inklusiv via < (Folgetag 00:00).
  let eventQuery = supabase
    .from("booklet_events")
    .select("booklet_id, event_type, ip_hash")
    .eq("business_id", businessId);
  if (query.from) {
    eventQuery = eventQuery.gte("created_at", `${query.from}T00:00:00.000Z`);
  }
  if (query.to) {
    eventQuery = eventQuery.lt("created_at", nextDayIso(query.to));
  }
  const { data: eventData } = await eventQuery.returns<EventRow[]>();

  // Aggregation je booklet_id.
  const aggByBooklet = new Map<string, Agg>();
  for (const e of eventData ?? []) {
    let agg = aggByBooklet.get(e.booklet_id);
    if (!agg) {
      agg = { reach: new Set<string>(), opens: 0, shares: 0 };
      aggByBooklet.set(e.booklet_id, agg);
    }
    if (e.event_type === "viewed") {
      agg.opens += 1;
      if (e.ip_hash) agg.reach.add(e.ip_hash); // null (keine IP) zählt nicht.
    } else if (e.event_type === "shared") {
      agg.shares += 1;
    }
  }

  // Zeilen bauen — nur Aufträge mit Booklet (brauchen booklet_id + sent_at).
  const rows: ReachRow[] = [];
  for (const o of orders) {
    const booklet = bookletByOrder.get(o.id);
    if (!booklet) continue;
    const agg = aggByBooklet.get(booklet.id);
    rows.push({
      orderId: o.id,
      customerName: o.customer_name,
      email: o.customer_email,
      phone: o.customer_phone,
      externalRef: o.external_ref,
      description: o.short_summary ?? o.item_description ?? null,
      sentAt: booklet.sent_at,
      reach: agg ? agg.reach.size : 0,
      opens: agg ? agg.opens : 0,
      shares: agg ? agg.shares : 0,
    });
  }

  return sortReachRows(rows, query.sort);
}
