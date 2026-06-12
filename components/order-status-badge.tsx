import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/**
 * Alle möglichen Auftrags-Status in Lifecycle-Reihenfolge (Spiegel der
 * DB-Check-Constraint auf `orders.status`). Quelle der Wahrheit für Liste,
 * Badge und den Status-Filter (Block B, Punkt 5) — als Laufzeit-Array, damit
 * sich die Filter-Optionen daraus ableiten lassen.
 */
export const ORDER_STATUSES = [
  "draft",
  "finalized",
  "generated",
  "sent",
  "viewed",
  "shared",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Typ-Guard: ist der String ein gültiger Auftrags-Status? */
export function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    typeof value === "string" &&
    (ORDER_STATUSES as readonly string[]).includes(value)
  );
}

type BadgeStyle = { background: string; border: string; color: string };

/**
 * Farbsätze nach **Lifecycle-Stufe** statt pro Status (6c) — die Liste zeigt so
 * auf einen Blick „in Arbeit / fertig / gesendet":
 *  - neutral  = in Arbeit (`draft`)
 *  - gold     = fertig (`finalized`, `generated`)
 *  - grünlich = gesendet/gesehen (`sent`, `viewed`, `shared`)
 */
const NEUTRAL: BadgeStyle = {
  background: "var(--surface)",
  border: "var(--border)",
  color: "var(--text-secondary)",
};
const GOLD: BadgeStyle = {
  background: "var(--gold-light)",
  border: "var(--gold-border)",
  color: "#8A7320",
};
const GREEN: BadgeStyle = {
  background: "var(--green-light)",
  border: "var(--green-border)",
  color: "var(--green-text)",
};

const STATUS_STYLES: Record<OrderStatus, BadgeStyle> = {
  draft: NEUTRAL,
  finalized: GOLD,
  generated: GOLD,
  sent: GREEN,
  viewed: GREEN,
  shared: GREEN,
};

/**
 * Status-Badge eines Auftrags: i18n-Label + Stil (pill, border-radius 999px).
 * Reine Präsentation — kann als Server Component gerendert werden.
 */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
        background: style.background,
        border: `1px solid ${style.border}`,
        color: style.color,
      }}
    >
      {t(DEFAULT_LOCALE, `orderStatus.${status}`)}
    </span>
  );
}
