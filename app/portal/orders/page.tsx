import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import {
  OrderStatusBadge,
  isOrderStatus,
  type OrderStatus,
} from "@/components/order-status-badge";
import { OrderStatusFilter } from "@/components/order-status-filter";
import { OrderQuickFilters } from "@/components/order-quick-filters";
import { OrdersPagination } from "@/components/orders-pagination";
import { OrdersRefreshButton } from "@/components/orders-refresh-button";
import type { ReelStatus } from "@/app/portal/orders/[id]/generate-controls";
import { PickupPendingBadge } from "@/components/pickup-pending-badge";
import { ArchiveToggle } from "@/components/archive-toggle";
import { isArchivable } from "@/lib/orders/archive";
import {
  ORDERS_PAGE_SIZE,
  buildOrdersUrl,
  isQuickFilter,
  isStatusFilter,
  type QuickFilter,
  type StatusFilter,
} from "@/lib/orders/filters";

/** Eine Zeile der Auftragsliste — nur die für die Übersicht benötigten Felder. */
type OrderListRow = {
  id: string;
  customer_name: string;
  external_ref: string | null;
  short_summary: string | null;
  status: OrderStatus;
  picked_up_at: string | null;
  created_at: string;
  archived_at: string | null;
};

const DATE_FORMAT = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/**
 * Auftragsliste (Server Component, mobile-first). Lädt über den AUTHENTICATED
 * Server-Client — RLS skopiert automatisch auf den Betrieb; zusätzlich wird
 * defensiv nach `business_id` aus `getCurrentBusiness` gefiltert.
 *
 * Zwei Scopes (gegenseitig ausschließend, über `?archived=1`):
 *  - Hauptliste (kein Param): nur Aufträge mit `archived_at IS NULL`.
 *  - Archiv-Ansicht (`?archived=1`): nur Aufträge mit `archived_at IS NOT NULL`.
 *
 * Filterung **server-seitig** über zwei sich gegenseitig ausschließende Achsen:
 *  - `?status=` — Status-Dropdown (ein einzelner Status, Block B).
 *  - `?quick=`  — Quick-Filter mit Mehrfach-/Sonderbedingungen (Block C / 3).
 * Quick hat Vorrang; ist ein Quick aktiv, fällt das Dropdown auf „Alle" zurück.
 * Paginierung über `?page=` (20 Karten/Seite) respektiert den aktiven Filter.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    quick?: string;
    page?: string;
    archived?: string;
  }>;
}) {
  const business = await getCurrentBusiness();
  if (!business) return null;

  const {
    status: statusParam,
    quick: quickParam,
    page: pageParam,
    archived: archivedParam,
  } = await searchParams;

  const isArchiveView = archivedParam === "1";

  // Zwei Filter-Achsen, mutually exclusive: Quick führt, sonst Status-Dropdown.
  // Ist ein Quick aktiv, wird der Dropdown-Wert verworfen (Dropdown zeigt „Alle").
  const activeQuick: QuickFilter | null = isQuickFilter(quickParam)
    ? quickParam
    : null;
  // Status-Dropdown-Achse: `draft` ist in zwei ABGELEITETE Werte gesplittet
  // („new"/„in_progress"); die übrigen sind echte Lifecycle-Status. KEIN neuer
  // `orders.status`-Wert — reine Filter-/Anzeige-Ableitung.
  const activeStatusFilter: StatusFilter | null =
    !activeQuick && isStatusFilter(statusParam) ? statusParam : null;

  // Seite (1-indexiert, Default 1). Ungültig/≤0 ⇒ 1.
  const parsedPage = Number.parseInt(pageParam ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  const supabase = await createClient();

  // EINE Zweitquery, die das Badge UND den Filter speist: alle Entwürfe des
  // aktuellen Scopes (aktiv/archiviert) MIT ≥1 Medium. `order_media!inner` ⇒
  // PostgREST liefert nur Aufträge mit mindestens einem Medium. RLS skopiert auf
  // den Betrieb; kein service_role. **Geschäftsweit** (nicht seiten-skopiert).
  const draftMediaBase = supabase
    .from("orders")
    .select("id, order_media!inner(id)")
    .eq("business_id", business.id)
    .eq("status", "draft");
  const { data: draftMediaRows } = await (isArchiveView
    ? draftMediaBase.not("archived_at", "is", null)
    : draftMediaBase.is("archived_at", null)
  ).returns<{ id: string }[]>();
  const draftWithMedia = new Set((draftMediaRows ?? []).map((r) => r.id));

  // „In Arbeit" = Entwurf MIT Medium ⇒ order_media!inner direkt in der Hauptquery.
  const mediaJoin = activeStatusFilter === "in_progress";
  const selectCols =
    "id, customer_name, external_ref, short_summary, status, picked_up_at, created_at, archived_at" +
    (mediaJoin ? ", order_media!inner(id)" : "");

  let query = supabase
    .from("orders")
    .select(selectCols, { count: "exact" })
    .eq("business_id", business.id);

  // Archiv-Scope: zeigt nur archivierte Aufträge; Hauptliste nur aktive.
  if (isArchiveView) {
    query = query.not("archived_at", "is", null);
  } else {
    query = query.is("archived_at", null);
  }

  // Filter-Übersetzung server-seitig (IN die Query, damit Pagination heil bleibt).
  if (activeQuick === "flagged") {
    query = query
      .not("picked_up_at", "is", null)
      .in("status", ["draft", "generated"]);
  } else if (activeStatusFilter === "new") {
    query = query.eq("status", "draft");
    if (draftWithMedia.size > 0) {
      query = query.not("id", "in", `(${[...draftWithMedia].join(",")})`);
    }
  } else if (activeStatusFilter === "in_progress") {
    query = query.eq("status", "draft");
  } else if (isOrderStatus(activeStatusFilter)) {
    query = query.eq("status", activeStatusFilter);
  }

  const from = (page - 1) * ORDERS_PAGE_SIZE;
  const { data, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + ORDERS_PAGE_SIZE - 1)
    .returns<OrderListRow[]>();

  const orders = data ?? [];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE));

  // Overshoot (z. B. manuell editierte URL oder veralteter Link nach Löschungen).
  if (page > totalPages) {
    redirect(
      buildOrdersUrl({
        status: activeStatusFilter,
        quick: activeQuick,
        archived: isArchiveView,
        page: totalPages,
      }),
    );
  }

  const hasActiveFilter = activeQuick !== null || activeStatusFilter !== null;
  const showFilter = total > 0 || hasActiveFilter;

  // Zweite Achse: Reel-Render-Status für generierte Aufträge.
  const generatedIds = orders
    .filter((o) => o.status === "generated")
    .map((o) => o.id);
  const reelByOrder = new Map<string, ReelStatus | null>();
  if (generatedIds.length > 0) {
    const { data: booklets } = await supabase
      .from("booklets")
      .select("order_id, reel_status")
      .in("order_id", generatedIds)
      .returns<{ order_id: string; reel_status: ReelStatus | null }[]>();
    for (const b of booklets ?? []) reelByOrder.set(b.order_id, b.reel_status);
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div className="orders-header">
        <div className="orders-title-row">
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>
            {isArchiveView
              ? t(DEFAULT_LOCALE, "orders.archiveView")
              : t(DEFAULT_LOCALE, "orders.title")}
          </h1>
          {isArchiveView ? (
            /* Archiv → Link zurück zur Hauptliste */
            <Link
              href="/portal/orders"
              className="btn-outline"
              style={{ fontSize: 13, padding: "5px 12px" }}
            >
              {t(DEFAULT_LOCALE, "orders.backToList")}
            </Link>
          ) : (
            /* Hauptliste → Refresh + Archiv-Link */
            <>
              <OrdersRefreshButton />
              <Link
                href={buildOrdersUrl({ archived: true })}
                className="orders-archive-link"
                title={t(DEFAULT_LOCALE, "orders.archiveView")}
              >
                <svg
                  width={18}
                  height={18}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <rect x="2" y="3" width="20" height="5" rx="1" />
                  <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
                  <path d="M10 12l2 2 2-2" />
                  <path d="M12 12v4" />
                </svg>
                <span>{t(DEFAULT_LOCALE, "orders.archiveView")}</span>
              </Link>
            </>
          )}
        </div>

        {showFilter ? (
          <>
            <OrderStatusFilter
              value={activeStatusFilter ?? "all"}
              quick={activeQuick}
            />
            {!isArchiveView && (
              <Link href="/portal/orders/new" className="btn-dark orders-new-btn">
                {t(DEFAULT_LOCALE, "orders.new")}
              </Link>
            )}
            <OrderQuickFilters active={activeQuick} />
          </>
        ) : null}
      </div>

      {total === 0 ? (
        hasActiveFilter ? (
          <div
            className="card"
            style={{ textAlign: "center", padding: "32px 24px" }}
          >
            <p style={{ margin: 0, color: "var(--text-secondary)" }}>
              {t(DEFAULT_LOCALE, "orders.emptyFiltered")}
            </p>
          </div>
        ) : isArchiveView ? (
          <div
            className="card"
            style={{ textAlign: "center", padding: "32px 24px" }}
          >
            <p style={{ margin: 0, color: "var(--text-secondary)" }}>
              {t(DEFAULT_LOCALE, "orders.emptyArchive")}
            </p>
          </div>
        ) : (
          <div
            className="card"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              textAlign: "center",
              padding: "40px 24px",
            }}
          >
            <p style={{ margin: 0, color: "var(--text-secondary)" }}>
              {t(DEFAULT_LOCALE, "orders.empty")}
            </p>
            <Link href="/portal/orders/new" className="btn-dark">
              {t(DEFAULT_LOCALE, "orders.new")}
            </Link>
          </div>
        )
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {orders.map((order) => {
              const flaggedDate =
                order.picked_up_at &&
                order.status !== "sent" &&
                order.status !== "viewed" &&
                order.status !== "shared"
                  ? order.picked_up_at
                  : null;

              const canArchive =
                !isArchiveView && isArchivable(order.status, order.picked_up_at);

              return (
                <Link
                  key={order.id}
                  href={`/portal/orders/${order.id}`}
                  className={`card card-link${flaggedDate ? " card-flagged" : ""}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {order.customer_name}
                      </div>
                      {order.short_summary ? (
                        <div
                          style={{
                            fontSize: 13,
                            color: "var(--text-primary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {order.short_summary}
                        </div>
                      ) : (
                        <div
                          style={{
                            fontSize: 13,
                            color: "var(--text-secondary)",
                            fontStyle: "italic",
                            opacity: 0.7,
                          }}
                        >
                          {t(DEFAULT_LOCALE, "orders.noDescription")}
                        </div>
                      )}
                      {order.external_ref ? (
                        <div
                          style={{ fontSize: 12, color: "var(--text-secondary)" }}
                        >
                          {order.external_ref}
                        </div>
                      ) : null}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: 6,
                        flexShrink: 0,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-end",
                          flexWrap: "wrap",
                          gap: 6,
                        }}
                      >
                        <OrderStatusBadge
                          status={order.status}
                          hasMedia={draftWithMedia.has(order.id)}
                          reelStatus={reelByOrder.get(order.id) ?? null}
                        />
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        {DATE_FORMAT.format(new Date(order.created_at))}
                      </div>
                      {/* Archiv-Icon: auf archivierbaren Aufträgen der Hauptliste
                          oder auf allen Aufträgen in der Archiv-Ansicht. */}
                      {canArchive ? (
                        <ArchiveToggle orderId={order.id} mode="archive" />
                      ) : isArchiveView ? (
                        <ArchiveToggle orderId={order.id} mode="unarchive" />
                      ) : null}
                    </div>
                  </div>
                  {flaggedDate ? (
                    <PickupPendingBadge pickedUpAt={flaggedDate} />
                  ) : null}
                </Link>
              );
            })}
          </div>

          <OrdersPagination
            page={page}
            totalPages={totalPages}
            status={activeStatusFilter}
            quick={activeQuick}
            archived={isArchiveView}
          />
        </>
      )}
    </div>
  );
}
