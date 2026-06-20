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
   * `order_media!inner(id)` an (damit auch die Bulk-Variante mit `select("id")`
   * korrekt über den Medien-Join filtert).
   */
  selectCols: string;
  /** Optional die count-Option (Liste: "exact"; Bulk: weglassen). */
  count?: "exact" | "planned" | "estimated";
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
 *  - `status ∈ {generated,sent,viewed,shared}` → status=<wert>.
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
  } = opts;

  // „In Arbeit" = Entwurf MIT Medium ⇒ order_media!inner direkt in der Query.
  const cols =
    status === "in_progress"
      ? `${selectCols}, order_media!inner(id)`
      : selectCols;

  let query = supabase
    .from("orders")
    .select(cols, count ? { count } : undefined)
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
  } else if (isOrderStatus(status)) {
    query = query.eq("status", status);
  }

  return query;
}
