"use client";

import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import {
  STATUS_FILTERS,
  buildOrdersUrl,
  isStatusFilter,
  type QuickFilter,
  type StatusFilter,
} from "@/lib/orders/filters";

/** Sentinel-Werte: auswählbare „Geflaggt"-Option + deaktivierter Trenner. */
const FLAGGED_VALUE = "__flagged__";
const SEPARATOR_VALUE = "__sep__";

/**
 * Status-Filter-Wert → i18n-Label-Key. Die abgeleiteten Filter teilen sich die
 * `orderStatus`-Labels mit dem zusammengesetzten Badge (kein Drift): die zwei
 * Entwurfs-Ableitungen (`draft` = „Neu", `inProgress` = „In Arbeit") und die drei
 * Reel-Render-Zustände von `generated` (`creating` = „Wird erstellt …", `ready` =
 * „Fertig", `failed` = „Fehler").
 */
const FILTER_LABEL_KEY: Record<
  StatusFilter,
  | "draft"
  | "inProgress"
  | "creating"
  | "ready"
  | "failed"
  | "sent"
  | "viewed"
  | "shared"
> = {
  new: "draft",
  in_progress: "inProgress",
  creating: "creating",
  ready: "ready",
  failed: "failed",
  sent: "sent",
  viewed: "viewed",
  shared: "shared",
};

/**
 * Status-Filter über der Auftragsliste (Block B, Punkt 5). Ein einfaches
 * `<select>` (EINE Auswahl): „Alle" (Default) + die Filter-Werte aus
 * `STATUS_FILTERS`. Der DB-Status `draft` ist dabei in zwei abgeleitete Werte
 * gesplittet („Neu" / „In Arbeit", anhand der Medien-Existenz) — KEIN neuer
 * `orders.status`-Wert. Die Liste lädt server-seitig (Server Component), daher
 * navigiert die Auswahl per Query-Param (`buildOrdersUrl`) — der Server filtert
 * dann. Kein `<form>`: reine Navigation per `onChange`.
 *
 * Quick-Filter „Geflaggt" als Dropdown-Option (Schritt A): die frühere
 * Chip-Zeile entfällt — der Filter „Abgeholt, Booklet nicht versendet" wird
 * jetzt als letzte, auswählbare Option (Wert `__flagged__`, nach einem
 * deaktivierten Trenner) im selben `<select>` geboten und routet weiter über
 * `?quick=flagged`. Status (`?status=`) und Quick (`?quick=`) bleiben getrennte,
 * sich ausschließende Achsen: jede Dropdown-Wahl baut eine frische URL über
 * `buildOrdersUrl` und droppt damit die jeweils andere Achse; „Alle" liefert die
 * nackte, ungefilterte Liste in EINEM Schritt.
 */
export function OrderStatusFilter({
  value,
  quick,
}: {
  value: StatusFilter | "all";
  quick: QuickFilter | null;
}) {
  const router = useRouter();
  // Aktiver Quick `flagged` ⇒ die „Geflaggt"-Option anzeigen; sonst der echte
  // Status bzw. „all".
  const selectValue =
    value !== "all" ? value : quick === "flagged" ? FLAGGED_VALUE : "all";
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        color: "var(--text-secondary)",
      }}
    >
      {t(DEFAULT_LOCALE, "orders.filterLabel")}
      <select
        className="form-input"
        value={selectValue}
        aria-label={t(DEFAULT_LOCALE, "orders.filterLabel")}
        onChange={(e) => {
          // Drei Fälle: „Geflaggt" ⇒ ?quick=flagged (droppt ?status=);
          // echter Status-Filter ⇒ ?status=X (droppt ?quick=); „all" (und der
          // deaktivierte Trenner feuert nie) ⇒ status: null ⇒ nackte Liste.
          const next = e.target.value;
          if (next === FLAGGED_VALUE) {
            router.push(buildOrdersUrl({ quick: "flagged" }));
          } else if (isStatusFilter(next)) {
            router.push(buildOrdersUrl({ status: next }));
          } else {
            router.push(buildOrdersUrl({ status: null }));
          }
        }}
        style={{ width: "auto", minWidth: 150 }}
      >
        <option value="all">{t(DEFAULT_LOCALE, "orders.filterAll")}</option>
        {STATUS_FILTERS.map((filter) => (
          <option key={filter} value={filter}>
            {t(DEFAULT_LOCALE, `orderStatus.${FILTER_LABEL_KEY[filter]}`)}
          </option>
        ))}
        <option value={SEPARATOR_VALUE} disabled>
          ──────
        </option>
        <option value={FLAGGED_VALUE}>
          {t(DEFAULT_LOCALE, "orders.quickFlagged")}
        </option>
      </select>
    </label>
  );
}
