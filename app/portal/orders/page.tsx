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
import {
  ReelStatePill,
  type ReelStatus,
} from "@/components/reel-state-pill";
import { PickupPendingBadge } from "@/components/pickup-pending-badge";
import {
  ORDERS_PAGE_SIZE,
  buildOrdersUrl,
  isQuickFilter,
  type QuickFilter,
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
 * Filterung **server-seitig** über zwei sich gegenseitig ausschließende Achsen:
 *  - `?status=` — Status-Dropdown (ein einzelner Status, Block B).
 *  - `?quick=`  — Quick-Filter mit Mehrfach-/Sonderbedingungen (Block C / 3).
 * Quick hat Vorrang; ist ein Quick aktiv, fällt das Dropdown auf „Alle" zurück.
 * Paginierung über `?page=` (20 Karten/Seite) respektiert den aktiven Filter.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; quick?: string; page?: string }>;
}) {
  const business = await getCurrentBusiness();
  if (!business) return null;

  const {
    status: statusParam,
    quick: quickParam,
    page: pageParam,
  } = await searchParams;

  // Zwei Filter-Achsen, mutually exclusive: Quick führt, sonst Status. Ist ein
  // Quick aktiv, wird der Dropdown-Wert verworfen (Dropdown zeigt „Alle").
  const activeQuick: QuickFilter | null = isQuickFilter(quickParam)
    ? quickParam
    : null;
  const activeStatus: OrderStatus | null =
    !activeQuick && isOrderStatus(statusParam) ? statusParam : null;

  // Seite (1-indexiert, Default 1). Ungültig/≤0 ⇒ 1.
  const parsedPage = Number.parseInt(pageParam ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  const supabase = await createClient();
  let query = supabase
    .from("orders")
    .select(
      "id, customer_name, external_ref, short_summary, status, picked_up_at, created_at",
      { count: "exact" },
    )
    .eq("business_id", business.id);

  // Quick-Filter ⇒ eigene WHERE-Logik (kein ?status=-Single-Value).
  if (activeQuick === "flagged") {
    // Exakt die Warn-Badge-Bedingung (Block C / Schritt 2): abgeholt, aber noch
    // nicht versendet. NOT IN {sent, viewed, shared} == IN {draft, generated}
    // (kein `finalized` mehr).
    query = query
      .not("picked_up_at", "is", null)
      .in("status", ["draft", "generated"]);
  } else if (activeQuick === "drafts") {
    query = query.eq("status", "draft");
  } else if (activeStatus) {
    query = query.eq("status", activeStatus);
  }

  const from = (page - 1) * ORDERS_PAGE_SIZE;
  const { data, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + ORDERS_PAGE_SIZE - 1)
    .returns<OrderListRow[]>();

  const orders = data ?? [];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE));

  // Overshoot (z. B. manuell editierte URL oder veralteter Link nach Löschungen):
  // angeforderte Seite > letzte Seite ⇒ auf die letzte Seite klemmen. So bleibt
  // nach der Weiche `orders.length === 0` ⟺ `total === 0`.
  if (page > totalPages) {
    redirect(
      buildOrdersUrl({
        status: activeStatus,
        quick: activeQuick,
        page: totalPages,
      }),
    );
  }

  const hasActiveFilter = activeQuick !== null || activeStatus !== null;
  // Filter-Leiste zeigen, sobald es Aufträge gibt ODER ein Filter aktiv ist
  // (damit man aus einem leeren Filter-Ergebnis wieder zurück auf „Alle" kann).
  const showFilter = total > 0 || hasActiveFilter;

  // Zweite Achse: Reel-Render-Status. Nur für generierte Aufträge relevant
  // (Booklet existiert, noch nicht versendet). booklets sind member-lesbar
  // (RLS, AUTHENTICATED Client) — kein service_role. Map order_id → reel_status.
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
            {t(DEFAULT_LOCALE, "orders.title")}
          </h1>
          {/* Refresh oben rechts: holt per Webhook reingekommene Aufträge nach. */}
          <OrdersRefreshButton />
        </div>

        {showFilter ? (
          <>
            <OrderStatusFilter
              value={activeStatus ?? "all"}
              quick={activeQuick}
            />
            <Link href="/portal/orders/new" className="btn-dark orders-new-btn">
              {t(DEFAULT_LOCALE, "orders.new")}
            </Link>
            <OrderQuickFilters active={activeQuick} />
          </>
        ) : null}
      </div>

      {total === 0 ? (
        hasActiveFilter ? (
          // Aktiver Filter ohne Treffer — Hinweis, Filter-Leiste bleibt oben.
          <div
            className="card"
            style={{ textAlign: "center", padding: "32px 24px" }}
          >
            <p style={{ margin: 0, color: "var(--text-secondary)" }}>
              {t(DEFAULT_LOCALE, "orders.emptyFiltered")}
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
              // Warn-Bedingung (Block C / Schritt 2): abgeholt, aber Booklet noch
              // nicht versendet. Doppel-Sicherung — bereits ausgelieferte Stufen
              // (sent/viewed/shared) nie warnen, selbst wenn picked_up_at
              // theoretisch noch gesetzt wäre. Truthy ⇒ String narrowt für die
              // Hinweiszeile.
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
                    <OrderStatusBadge status={order.status} />
                    {order.status === "generated" ? (
                      <ReelStatePill
                        reelStatus={reelByOrder.get(order.id) ?? null}
                      />
                    ) : null}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {DATE_FORMAT.format(new Date(order.created_at))}
                  </div>
                </div>
                </div>
                {/* Warn-Hinweis (Block C / Schritt 2): roapp meldete „Abgeholt",
                    Booklet aber noch nicht versendet. Volle-Breite-Zeile am
                    unteren Kartenrand statt überbreitem Inline-Pill; die Karte
                    trägt zusätzlich eine rote Umrandung (.card-flagged). */}
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
            status={activeStatus}
            quick={activeQuick}
          />
        </>
      )}
    </div>
  );
}
