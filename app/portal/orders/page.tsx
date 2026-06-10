import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import {
  OrderStatusBadge,
  type OrderStatus,
} from "@/components/order-status-badge";

/** Eine Zeile der Auftragsliste — nur die für die Übersicht benötigten Felder. */
type OrderListRow = {
  id: string;
  customer_name: string;
  external_ref: string | null;
  status: OrderStatus;
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
 */
export default async function OrdersPage() {
  const business = await getCurrentBusiness();
  if (!business) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("id, customer_name, external_ref, status, created_at")
    .eq("business_id", business.id)
    .order("created_at", { ascending: false })
    .returns<OrderListRow[]>();

  const orders = data ?? [];

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
          {t(DEFAULT_LOCALE, "orders.title")}
        </h1>
        <Link href="/portal/orders/new" className="btn-dark">
          {t(DEFAULT_LOCALE, "orders.new")}
        </Link>
      </div>

      {orders.length === 0 ? (
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
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {orders.map((order) => (
            <div
              key={order.id}
              className="card"
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
                {order.external_ref ? (
                  <div
                    style={{ fontSize: 13, color: "var(--text-secondary)" }}
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
                <OrderStatusBadge status={order.status} />
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {DATE_FORMAT.format(new Date(order.created_at))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
