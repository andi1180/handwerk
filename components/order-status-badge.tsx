import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/**
 * Alle möglichen Auftrags-Status (Spiegel der DB-Check-Constraint auf
 * `orders.status`). Quelle der Wahrheit für Liste und Badge.
 */
export type OrderStatus =
  | "draft"
  | "finalized"
  | "generated"
  | "sent"
  | "viewed"
  | "shared";

/** Pro Status ein dezenter Farbsatz (Hotel-Badge-Muster). `draft` = neutral. */
const STATUS_STYLES: Record<
  OrderStatus,
  { background: string; border: string; color: string }
> = {
  draft: {
    background: "var(--surface)",
    border: "var(--border)",
    color: "var(--text-secondary)",
  },
  finalized: { background: "#EAF3EC", border: "#CFE3D4", color: "#2E7D46" },
  generated: {
    background: "var(--gold-light)",
    border: "var(--gold-border)",
    color: "#8A7320",
  },
  sent: { background: "#E9EFF8", border: "#CFDCEF", color: "#2F5DA8" },
  viewed: { background: "#F0EAF6", border: "#DECFEA", color: "#6B4B8A" },
  shared: { background: "#E6F4F1", border: "#CDE8E2", color: "#1E7A6A" },
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
