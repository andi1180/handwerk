import type { createClient } from "@/lib/supabase/server";
import { isOrderStatus } from "@/components/order-status-badge";
import type { QuickFilter, StatusFilter } from "@/lib/orders/filters";

/** Authentifizierter Server-Supabase-Client (RLS-erzwungen, KEIN service_role). */
type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Parameter des geteilten Filter-Query-Baus der Auftragsliste. */
export type FilteredOrdersOptions = {
  /** Betrieb aus der Session (§14.2 — NIE aus Client/Body). */
  businessId: string;
  /** Status-Dropdown-Achse (`?status=`) oder null. */
  status: StatusFilter | null;
  /** Quick-Filter-Achse (`?quick=`) oder null. Hat Vorrang vor `status`. */
  quick: QuickFilter | null;
  /** Archiv-Scope: true ⇒ nur archivierte, false ⇒ nur aktive Aufträge. */
  archived: boolean;
  /**
   * Geschäftsweite Menge der Entwürfe MIT ≥1 Medium — vom Aufrufer vorab geladen
   * (speist auch das `hasMedia`-Badge). Für `status='new'` (= „Entwurf OHNE
   * Medium") wird `id NOT IN` dieser Menge gefiltert.
   */
  draftWithMediaIds: Set<string>;
  /**
   * Basis-Spaltenliste. Bei `status='in_progress'` hängt die Funktion
   * `order_media!inner(id)` an; bei `status ∈ {creating, ready, failed}`
   * `booklets!inner(reel_status)` (damit auch die Bulk-Variante mit `select("id")`
   * korrekt über den jeweiligen Inner-Join filtert).
   */
  selectCols: string;
  /** Optional die count-Option (Liste: "exact"; Bulk: weglassen). */
  count?: "exact" | "planned" | "estimated";
  /**
   * Optional `head: true` — nur den `count` holen, KEINE Zeilen übertragen
   * (für den by-filter-Bulk-Count, GET). Wirkt nur zusammen mit `count`.
   * Default (undefined/false): Zeilen werden geladen — Verhalten der Liste
   * bleibt unverändert (sie übergibt `head` nicht).
   */
  head?: boolean;
  /**
   * Optionaler Freitext-Suchbegriff (Auftragslisten-Suche, Schritt B). ADDITIV
   * zur Filter-Verzweigung (status/quick) — sucht über Kundenname / externe
   * Referenz / E-Mail / Telefon. **Sanitisiert** gegen `.or()`-Injection (nur
   * Buchstaben/Ziffern + `@ . + - _` + Leerzeichen bleiben; alle PostgREST-
   * Sonderzeichen werden gestrippt). Leer/nur-Sonderzeichen ⇒ kein Filter.
   */
  q?: string;
};

/**
 * Baut die gefilterte (un-ge-`order`-te, un-ge-`range`-te) Auftrags-Query —
 * **eine Quelle** für die Liste (volle Spalten + count) UND den by-filter-Bulk
 * (`select "id"`). Basis (`business_id`) + Archiv-Scope + Filter-Verzweigung
 * (quick/status), exakt wie zuvor inline in der Auftragsliste.
 *
 * Liefert den Query-Builder OHNE `.order()` und OHNE `.range()` — die hängt der
 * Aufrufer an. Ausschließlich AUTHENTICATED Client (RLS); kein service_role.
 *
 *  - `quick='flagged'`      → picked_up_at gesetzt UND status ∈ {draft, generated}.
 *  - `status='new'`         → status='draft' UND id NOT IN draftWithMediaIds.
 *  - `status='in_progress'` → status='draft' (+ order_media!inner(id) im select).
 *  - `status='creating'`    → status='generated' UND reel_status ∈ {pending,rendering}.
 *  - `status='ready'`       → status='generated' UND reel_status='ready'.
 *  - `status='failed'`      → status='generated' UND reel_status='failed'.
 *    (Die drei composite-Filter via booklets!inner(reel_status) im select.)
 *  - `status ∈ {sent,viewed,shared}` → status=<wert>.
 *  - sonst (null/null)      → kein Status-Filter.
 */
export function buildFilteredOrdersQuery(
  supabase: ServerClient,
  opts: FilteredOrdersOptions,
) {
  const {
    businessId,
    status,
    quick,
    archived,
    draftWithMediaIds,
    selectCols,
    count,
    head,
    q,
  } = opts;

  // „In Arbeit" = Entwurf MIT Medium ⇒ order_media!inner direkt in der Query;
  // die Reel-Composite-Filter (creating/ready/failed) ⇒ booklets!inner(reel_status).
  const cols =
    status === "in_progress"
      ? `${selectCols}, order_media!inner(id)`
      : status === "creating" || status === "ready" || status === "failed"
        ? `${selectCols}, booklets!inner(reel_status)`
        : selectCols;

  // `head` nur zusammen mit `count` setzen; ohne `head` bleibt das Select-Argument
  // exakt `{ count }` (Liste unverändert) bzw. `undefined`.
  let query = supabase
    .from("orders")
    .select(cols, count ? (head ? { count, head: true } : { count }) : undefined)
    .eq("business_id", businessId);

  // Archiv-Scope: zeigt nur archivierte Aufträge; Hauptliste nur aktive.
  if (archived) {
    query = query.not("archived_at", "is", null);
  } else {
    query = query.is("archived_at", null);
  }

  // Filter-Übersetzung server-seitig (IN die Query, damit Pagination heil bleibt).
  if (quick === "flagged") {
    query = query
      .not("picked_up_at", "is", null)
      .in("status", ["draft", "generated"]);
  } else if (status === "new") {
    query = query.eq("status", "draft");
    if (draftWithMediaIds.size > 0) {
      query = query.not("id", "in", `(${[...draftWithMediaIds].join(",")})`);
    }
  } else if (status === "in_progress") {
    query = query.eq("status", "draft");
  } else if (status === "creating") {
    query = query
      .eq("status", "generated")
      .in("booklets.reel_status", ["pending", "rendering"]);
  } else if (status === "ready") {
    query = query.eq("status", "generated").eq("booklets.reel_status", "ready");
  } else if (status === "failed") {
    query = query.eq("status", "generated").eq("booklets.reel_status", "failed");
  } else if (isOrderStatus(status)) {
    query = query.eq("status", status);
  }

  // Freitext-Suche (Schritt B) — ADDITIV zur obigen Filter-Verzweigung.
  // ⚠️ Das `replace` IST die Injection-Absicherung: es lässt NUR Unicode-
  // Buchstaben/Ziffern + `@ . + - _` + Leerzeichen durch und strippt alle
  // PostgREST-`.or()`-Sonderzeichen (`,` `(` `)` `*` `\` `:` `"` …). Bleibt nach
  // dem Strippen nichts übrig ⇒ kein Filter. `customer_email`/`customer_phone`
  // müssen NICHT in `selectCols` stehen (PostgREST filtert auch auf nicht
  // selektierte Spalten).
  const safe = (q ?? "").replace(/[^\p{L}\p{N}@.+\-_ ]/gu, "").trim();
  if (safe) {
    const pat = `*${safe}*`;
    query = query.or(
      `customer_name.ilike.${pat},external_ref.ilike.${pat},customer_email.ilike.${pat},customer_phone.ilike.${pat}`,
    );
  }

  return query;
}

/**
 * Geschäftsweite Menge der Entwürfe (`status='draft'`) MIT ≥1 `order_media` —
 * **eine Quelle** für das `hasMedia`-Badge + den `status='new'`-Filter der Liste
 * (`page.tsx`) UND den by-filter-Bulk (`status='new'` braucht exakt dieselbe
 * Menge, sonst trifft die Massen-Archivierung eine ANDERE Menge als die Liste
 * anzeigt). Vorher inline in `page.tsx` — hier extrahiert, damit kein Drift.
 *
 * `order_media!inner` ⇒ PostgREST liefert nur Aufträge mit mindestens einem
 * Medium (eine Zeile je Auftrag, Kinder genestet). Skope nach `archived`
 * (Hauptliste: aktiv; Archiv-Scope: archiviert). Ausschließlich AUTHENTICATED
 * Client (RLS); kein service_role.
 */
export async function getDraftWithMediaIds(
  supabase: ServerClient,
  opts: { businessId: string; archived: boolean },
): Promise<Set<string>> {
  const base = supabase
    .from("orders")
    .select("id, order_media!inner(id)")
    .eq("business_id", opts.businessId)
    .eq("status", "draft");
  const { data } = await (
    opts.archived ? base.not("archived_at", "is", null) : base.is("archived_at", null)
  ).returns<{ id: string }[]>();
  return new Set((data ?? []).map((r) => r.id));
}
