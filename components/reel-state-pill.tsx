import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import { type ReelStatus } from "@/app/portal/orders/[id]/generate-controls";

export type { ReelStatus };

type PillStyle = { background: string; border: string; color: string };

/**
 * Farbsätze der Reel-Status-Pill (8d). Amber ist bewusst aufmerksamkeitsstark —
 * „Reel fehlt" ist der Kern dieser Anzeige. Blau = laufend, Grün = fertig,
 * Rot = fehlgeschlagen.
 */
const AMBER: PillStyle = {
  background: "var(--amber-light)",
  border: "var(--amber-border)",
  color: "var(--amber-text)",
};
const BLUE: PillStyle = {
  background: "var(--blue-light)",
  border: "var(--blue-border)",
  color: "var(--blue-text)",
};
const GREEN: PillStyle = {
  background: "var(--green-light)",
  border: "var(--green-border)",
  color: "var(--green-text)",
};
const RED: PillStyle = {
  background: "var(--red-light)",
  border: "var(--red-border)",
  color: "var(--red-text)",
};

type PillKey = "reelMissing" | "reelRendering" | "reelReady" | "reelFailed";

/** Reel-Status (DB) → Pill-Stil + i18n-Label. `pending` ist der Default-Fall. */
const PILL: Record<ReelStatus, { style: PillStyle; key: PillKey }> = {
  pending: { style: AMBER, key: "reelMissing" },
  rendering: { style: BLUE, key: "reelRendering" },
  ready: { style: GREEN, key: "reelReady" },
  failed: { style: RED, key: "reelFailed" },
};

/**
 * Reel-Status-Pill für die Auftragsliste (8d) — die **zweite Achse** neben dem
 * Auftrags-Status-Badge: `order.status` (Lifecycle) vs. `booklets.reel_status`
 * (Render-Zustand). Nur im Auftrags-Status `generated` sinnvoll (Booklet
 * existiert, noch nicht versendet); die Liste rendert die Pill ausschließlich
 * dort. Fehlender/`pending`-Status (oder kein Booklet ⇒ `null`) ⇒ „Reel fehlt".
 * Reine Präsentation — Server-Component-fähig.
 */
export function ReelStatePill({
  reelStatus,
}: {
  reelStatus: ReelStatus | null;
}) {
  const { style, key } = reelStatus == null ? PILL.pending : PILL[reelStatus];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: "nowrap",
        background: style.background,
        border: `1px solid ${style.border}`,
        color: style.color,
      }}
    >
      {t(DEFAULT_LOCALE, `orderStatus.${key}`)}
    </span>
  );
}
