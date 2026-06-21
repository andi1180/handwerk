import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import {
  OrderStatusBadge,
  type OrderStatus,
} from "@/components/order-status-badge";
import { OrderStatusFilter } from "@/components/order-status-filter";
import { OrderQuickFilters } from "@/components/order-quick-filters";
import { OrdersPagination } from "@/components/orders-pagination";
import { OrdersRefreshButton } from "@/components/orders-refresh-button";
import type { ReelStatus } from "@/app/portal/orders/[id]/generate-controls";
import {
  BusinessReelButton,
  type BusinessReelStatus,
} from "@/components/business-reel-button";
import { PickupPendingBadge } from "@/components/pickup-pending-badge";
import {
  OrderBulkSelectProvider,
  OrderRowControls,
  OrdersArchiveMenu,
} from "@/components/order-bulk-archive";
import { isArchivable } from "@/lib/orders/archive";
import {
  ORDERS_PAGE_SIZE,
  buildOrdersUrl,
  isQuickFilter,
  isStatusFilter,
  type QuickFilter,
  type StatusFilter,
} from "@/lib/orders/filters";
import {
  buildFilteredOrdersQuery,
  getDraftWithMediaIds,
} from "@/lib/orders/orders-query";

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

  // EINE Zweitquery (geteilter Helfer), die das Badge UND den Filter speist: alle
  // Entwürfe des aktuellen Scopes (aktiv/archiviert) MIT ≥1 Medium. RLS skopiert
  // auf den Betrieb; kein service_role. **Geschäftsweit** (nicht seiten-skopiert).
  // Derselbe Helfer trägt den by-filter-Bulk (`status='new'`) ⇒ kein Drift.
  const draftWithMedia = await getDraftWithMediaIds(supabase, {
    businessId: business.id,
    archived: isArchiveView,
  });

  // Gefilterte (un-ge-`order`-te, un-ge-`range`-te) Query über den geteilten
  // Builder — dieselbe Filter-Verzweigung speist später den by-filter-Bulk.
  // `.order()`/`.range()` hängt die Liste selbst an. `draftWithMedia` (oben für
  // das Badge berechnet) trägt das NOT-IN von `status='new'`.
  const from = (page - 1) * ORDERS_PAGE_SIZE;
  const { data, count } = await buildFilteredOrdersQuery(supabase, {
    businessId: business.id,
    status: activeStatusFilter,
    quick: activeQuick,
    archived: isArchiveView,
    draftWithMediaIds: draftWithMedia,
    selectCols:
      "id, customer_name, external_ref, short_summary, status, picked_up_at, created_at, archived_at",
    count: "exact",
  })
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

  // Zweite Achse: Reel-Render-Status für generierte/ausgelieferte Aufträge.
  // Scope: alle Aufträge mit Booklet (generated/sent/viewed/shared) — spiegelt
  // RENDERABLE_STATUSES aus den beiden render-*-Routen.
  const RENDERABLE = ["generated", "sent", "viewed", "shared"] as const;
  const renderableIds = orders
    .filter((o) => (RENDERABLE as readonly string[]).includes(o.status))
    .map((o) => o.id);

  type BookletEntry = {
    reel_status: ReelStatus | null;
    business_reel_status: BusinessReelStatus | null;
  };
  const reelByOrder = new Map<string, BookletEntry>();

  // Gate-Map: Vorher/Nachher-Fotos je Auftrag (Bedingung für das Betriebs-Reel).
  const gateByOrder = new Map<string, { hasBefore: boolean; hasAfter: boolean }>();

  if (renderableIds.length > 0) {
    // Beide Queries parallel — ein Round-Trip.
    const [bookletResult, gateResult] = await Promise.all([
      supabase
        .from("booklets")
        .select("order_id, reel_status, business_reel_status")
        .in("order_id", renderableIds)
        .returns<
          {
            order_id: string;
            reel_status: ReelStatus | null;
            business_reel_status: BusinessReelStatus | null;
          }[]
        >(),
      supabase
        .from("order_media")
        .select("order_id, category")
        .in("order_id", renderableIds)
        .in("category", ["before", "after"])
        .returns<{ order_id: string; category: string }[]>(),
    ]);

    for (const b of bookletResult.data ?? []) {
      reelByOrder.set(b.order_id, {
        reel_status: b.reel_status,
        business_reel_status: b.business_reel_status,
      });
    }

    // Aggregiere Vorher/Nachher je Auftrag.
    for (const row of gateResult.data ?? []) {
      const entry = gateByOrder.get(row.order_id) ?? {
        hasBefore: false,
        hasAfter: false,
      };
      if (row.category === "before") entry.hasBefore = true;
      if (row.category === "after") entry.hasAfter = true;
      gateByOrder.set(row.order_id, entry);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <OrderBulkSelectProvider
        orderIds={orders.map((o) => o.id)}
        status={activeStatusFilter}
        quick={activeQuick}
      >
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
            /* Hauptliste → Refresh + „Archiv ▾"-Dropdown (Archiv / Auswählen) */
            <>
              <OrdersRefreshButton />
              <OrdersArchiveMenu />
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
                          reelStatus={
                            reelByOrder.get(order.id)?.reel_status ?? null
                          }
                        />
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        {DATE_FORMAT.format(new Date(order.created_at))}
                      </div>
                      {/* Kachel-Kontrolle (Client): Auswahl-Checkbox im
                          Select-Mode, sonst Einzel-Archiv-Icon (Hauptliste,
                          archivierbar) bzw. Entarchivieren-Icon (Archiv-Scope). */}
                      <OrderRowControls
                        orderId={order.id}
                        archivable={isArchivable(
                          order.status,
                          order.picked_up_at,
                        )}
                        archiveView={isArchiveView}
                      />
                    </div>
                  </div>
                  {flaggedDate ? (
                    <PickupPendingBadge pickedUpAt={flaggedDate} />
                  ) : null}
                  {(RENDERABLE as readonly string[]).includes(order.status) ? (
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <BusinessReelButton
                        orderId={order.id}
                        status={
                          reelByOrder.get(order.id)?.business_reel_status ??
                          "pending"
                        }
                        gateOk={Boolean(
                          gateByOrder.get(order.id)?.hasBefore &&
                            gateByOrder.get(order.id)?.hasAfter,
                        )}
                      />
                    </div>
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
      </OrderBulkSelectProvider>
    </div>
  );
}
