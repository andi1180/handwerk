"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import { REACH_SORTS, type ReachSort } from "@/lib/analytics/reach";

/**
 * Statische Zuordnung Sortier-Achse → i18n-Label (Muster wie die Quick-Filter,
 * components/order-quick-filters.tsx) — vermeidet einen dynamischen Template-
 * Literal-Key und hält die `t`-Aufrufe typsicher.
 */
const SORT_LABEL: Record<
  ReachSort,
  "sortReach" | "sortOpens" | "sortShares" | "sortSent" | "sortName"
> = {
  reichweite: "sortReach",
  oeffnungen: "sortOpens",
  teilen: "sortShares",
  versanddatum: "sortSent",
  name: "sortName",
};

/**
 * Filter-Leiste der Reichweiten-Analyse (Datumsbereich von/bis + Sortierung).
 * Kleine Client-Insel: jede Änderung setzt den jeweiligen URL-Search-Param via
 * `router.replace` — der Server (Dashboard-Server-Component) filtert/sortiert
 * dann. KEIN `<form>`, reine Navigation; bestehende Params bleiben erhalten.
 */
export function ReachFilterBar({
  from,
  to,
  sort,
}: {
  from: string; // "" oder YYYY-MM-DD
  to: string; // "" oder YYYY-MM-DD
  sort: ReachSort;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const update = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    const qs = params.toString();
    router.replace(qs ? `/portal?${qs}` : "/portal");
  };

  return (
    <div className="reach-filter">
      <label className="reach-filter-field">
        <span>{t(DEFAULT_LOCALE, "reach.from")}</span>
        <input
          type="date"
          className="form-input"
          value={from}
          max={to || undefined}
          onChange={(e) => update("from", e.target.value)}
        />
      </label>
      <label className="reach-filter-field">
        <span>{t(DEFAULT_LOCALE, "reach.to")}</span>
        <input
          type="date"
          className="form-input"
          value={to}
          min={from || undefined}
          onChange={(e) => update("to", e.target.value)}
        />
      </label>
      <label className="reach-filter-field">
        <span>{t(DEFAULT_LOCALE, "reach.sort")}</span>
        <select
          className="form-input"
          value={sort}
          aria-label={t(DEFAULT_LOCALE, "reach.sort")}
          onChange={(e) => update("sort", e.target.value)}
        >
          {REACH_SORTS.map((s) => (
            <option key={s} value={s}>
              {t(DEFAULT_LOCALE, `reach.${SORT_LABEL[s]}`)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
