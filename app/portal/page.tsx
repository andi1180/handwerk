import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import type { OrderStatus } from "@/components/order-status-badge";
import { ReachFilterBar } from "@/components/reach-filter-bar";
import {
  DEFAULT_REACH_SORT,
  formatReachDate,
  isReachSort,
  loadReachRows,
  parseDateParam,
  type ReachRow,
  type ReachSort,
} from "@/lib/analytics/reach";

/** Rohzeile der Events-Query (nur die für die Aggregation nötigen Felder). */
type EventRow = {
  event_type: string;
  channel: string | null;
  ip_hash: string | null;
};

/** Teil-Kanäle (Reihenfolge = Anzeige). Spiegelt lib/booklet/events.ts. */
const SHARE_CHANNELS = ["reel", "story", "whatsapp", "copy"] as const;
/** Klick-Kanäle (Reihenfolge = Anzeige). Spiegelt lib/booklet/events.ts. */
const CLICK_CHANNELS = ["website", "review", "ig"] as const;
type ShareChannel = (typeof SHARE_CHANNELS)[number];
type ClickChannel = (typeof CLICK_CHANNELS)[number];

/**
 * Analytics-Dashboard auf der Portal-Startseite (Schritt 10b, Server Component).
 *
 * Daten ausschließlich über den AUTHENTICATED Client (RLS skopiert auf den
 * Betrieb; zusätzlich defensiver `business_id`-Filter) — KEIN service_role.
 *
 * Funnel: drei head-`count`-Queries auf `orders` (Status-Stufen). Engagement:
 * EINE Query lädt `booklet_events` und aggregiert in JS (Views/Shares/Klicks).
 * Single-fetch + JS-Aggregation ist bewusst MVP — bei Skalierung später ein
 * SQL-Aggregat/RPC (dann mit der REVOKE-EXECUTE-Konvention, §14.3). Jetzt nicht.
 */
export default async function PortalDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; sort?: string }>;
}) {
  const business = await getCurrentBusiness();
  if (!business) return null;

  const supabase = await createClient();

  // Reichweiten-/VIP-Analyse-Filter aus den URL-Params (server-seitig).
  const { from: fromParam, to: toParam, sort: sortParam } = await searchParams;
  const reachFrom = parseDateParam(fromParam);
  const reachTo = parseDateParam(toParam);
  const reachSort: ReachSort = isReachSort(sortParam)
    ? sortParam
    : DEFAULT_REACH_SORT;

  const countOrders = async (statuses: OrderStatus[]): Promise<number> => {
    const { count } = await supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("business_id", business.id)
      .in("status", statuses);
    return count ?? 0;
  };

  const [delivered, viewedCount, sharedCount, eventsResult] =
    await Promise.all([
      countOrders(["sent", "viewed", "shared"]),
      countOrders(["viewed", "shared"]),
      countOrders(["shared"]),
      supabase
        .from("booklet_events")
        .select("event_type, channel, ip_hash")
        .eq("business_id", business.id)
        .returns<EventRow[]>(),
    ]);

  const events = eventsResult.data ?? [];

  // JS-Aggregation der Events (single-fetch, s. Doc-Kommentar oben).
  let viewsTotal = 0;
  const uniqueIps = new Set<string>();
  const shares: Record<ShareChannel, number> = {
    reel: 0,
    story: 0,
    whatsapp: 0,
    copy: 0,
  };
  const clicks: Record<ClickChannel, number> = {
    website: 0,
    review: 0,
    ig: 0,
  };

  for (const e of events) {
    if (e.event_type === "viewed") {
      viewsTotal += 1;
      // Eindeutige Aufrufe = distinct ip_hash; null (keine IP) zählt nicht mit.
      if (e.ip_hash) uniqueIps.add(e.ip_hash);
    } else if (e.event_type === "shared") {
      if (e.channel !== null && e.channel in shares) {
        shares[e.channel as ShareChannel] += 1;
      }
    } else if (e.event_type === "link_click") {
      if (e.channel !== null && e.channel in clicks) {
        clicks[e.channel as ClickChannel] += 1;
      }
    }
  }
  const viewsUnique = uniqueIps.size;

  const shareRate =
    delivered > 0 ? Math.round((sharedCount / delivered) * 100) : 0;

  // Konsistenter Seitenkopf (analog zur „Aufträge"-Überschrift). Das
  // Betriebs-Logo wird bewusst NUR in der Top-Bar (layout.tsx) gerendert —
  // sie sitzt auf allen Portal-Seiten —, damit es nicht doppelt erscheint.
  const header = (
    <div className="dashboard-head">
      <h1 className="dashboard-title">{t(DEFAULT_LOCALE, "dashboard.title")}</h1>
    </div>
  );

  // Leerer Zustand: noch nichts ausgeliefert UND keine Events.
  const hasData = delivered > 0 || events.length > 0;
  if (!hasData) {
    return (
      <div className="dashboard">
        {header}
        <div className="card dashboard-empty">
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>
            {t(DEFAULT_LOCALE, "dashboard.empty")}
          </p>
        </div>
      </div>
    );
  }

  // Balken-Maxima: Funnel relativ zu „Ausgeliefert", Kanäle je Gruppe relativ
  // zum größten Wert (1 als Untergrenze gegen Division durch 0).
  const maxShare = Math.max(1, ...SHARE_CHANNELS.map((c) => shares[c]));
  const maxClick = Math.max(1, ...CLICK_CHANNELS.map((c) => clicks[c]));

  // Reichweiten-/VIP-Analyse: ausgelieferte Booklets je mit Engagement im
  // gewählten Zeitraum. Geteilte Aggregation (lib/analytics/reach.ts) — dieselbe
  // Quelle wie der CSV-Export; die Seite zeigt die Top 10 nach Sortierung.
  const reachRows = await loadReachRows(supabase, business.id, {
    from: reachFrom,
    to: reachTo,
    sort: reachSort,
  });

  return (
    <div className="dashboard">
      {header}

      {/* Headline: Share-Rate — die Kernkennzahl der Produkt-These. */}
      <section className="card dashboard-hero">
        <div className="dashboard-hero-rate">
          {shareRate}
          <span className="dashboard-hero-pct">%</span>
        </div>
        <div className="dashboard-hero-label">
          {t(DEFAULT_LOCALE, "dashboard.shareRate")}
        </div>
        <p className="dashboard-hero-hint">
          {t(DEFAULT_LOCALE, "dashboard.shareRateHint")}
        </p>
        <div className="dashboard-hero-sub">
          <Stat
            value={sharedCount}
            label={t(DEFAULT_LOCALE, "dashboard.shared")}
          />
          <Stat
            value={delivered}
            label={t(DEFAULT_LOCALE, "dashboard.delivered")}
          />
        </div>
      </section>

      <div className="dashboard-grid">
        {/* Funnel: Ausgeliefert → Angesehen → Geteilt (Breite relativ zu Ausgeliefert). */}
        <section className="card">
          <h2 className="dashboard-section-title">
            {t(DEFAULT_LOCALE, "dashboard.funnel")}
          </h2>
          <BarRow
            label={t(DEFAULT_LOCALE, "dashboard.delivered")}
            value={delivered}
            max={delivered}
          />
          <BarRow
            label={t(DEFAULT_LOCALE, "dashboard.viewed")}
            value={viewedCount}
            max={delivered}
          />
          <BarRow
            label={t(DEFAULT_LOCALE, "dashboard.shared")}
            value={sharedCount}
            max={delivered}
          />
        </section>

        {/* Aufrufe: eindeutig vs. gesamt nebeneinander. */}
        <section className="card">
          <h2 className="dashboard-section-title">
            {t(DEFAULT_LOCALE, "dashboard.views")}
          </h2>
          <div className="dashboard-stats-row">
            <Stat
              big
              value={viewsUnique}
              label={t(DEFAULT_LOCALE, "dashboard.uniqueViews")}
            />
            <Stat
              big
              value={viewsTotal}
              label={t(DEFAULT_LOCALE, "dashboard.totalViews")}
            />
          </div>
        </section>

        {/* Teilungen nach Kanal. */}
        <section className="card">
          <h2 className="dashboard-section-title">
            {t(DEFAULT_LOCALE, "dashboard.sharesByChannel")}
          </h2>
          {SHARE_CHANNELS.map((c) => (
            <BarRow
              key={c}
              label={t(DEFAULT_LOCALE, `dashboard.${c}`)}
              value={shares[c]}
              max={maxShare}
            />
          ))}
        </section>

        {/* Klicks nach Kanal. */}
        <section className="card">
          <h2 className="dashboard-section-title">
            {t(DEFAULT_LOCALE, "dashboard.clicks")}
          </h2>
          {CLICK_CHANNELS.map((c) => (
            <BarRow
              key={c}
              label={t(DEFAULT_LOCALE, `dashboard.${c}`)}
              value={clicks[c]}
              max={maxClick}
            />
          ))}
        </section>
      </div>

      <ReachSection
        rows={reachRows}
        from={reachFrom ?? ""}
        to={reachTo ?? ""}
        sort={reachSort}
      />
    </div>
  );
}

/** Baut den Export-Link mit den aktuellen Filter-Params (Default-Sort inklusive). */
function buildReachExportHref(q: {
  from: string | null;
  to: string | null;
  sort: ReachSort;
}): string {
  const params = new URLSearchParams();
  if (q.from) params.set("from", q.from);
  if (q.to) params.set("to", q.to);
  params.set("sort", q.sort);
  return `/portal/analytics/reichweite/export?${params.toString()}`;
}

/**
 * Reichweiten-/VIP-Analyse-Sektion (Server Component): Filter-Leiste +
 * Export-Button + Tabelle mit den TOP-10 Zeilen nach aktueller Sortierung. Der
 * Export-Anchor lädt die VOLLE gefilterte+sortierte Liste über die Route.
 */
function ReachSection({
  rows,
  from,
  to,
  sort,
}: {
  rows: ReachRow[];
  from: string;
  to: string;
  sort: ReachSort;
}) {
  const top = rows.slice(0, 10);
  const exportHref = buildReachExportHref({
    from: from || null,
    to: to || null,
    sort,
  });

  return (
    <section className="card reach">
      <div className="reach-head">
        <div>
          <h2 className="dashboard-section-title" style={{ marginBottom: 4 }}>
            {t(DEFAULT_LOCALE, "reach.title")}
          </h2>
          <p className="reach-hint">{t(DEFAULT_LOCALE, "reach.hint")}</p>
        </div>
        {/* Export der VOLLEN Liste (nicht nur Top 10) mit den aktuellen Params. */}
        <a className="btn-outline reach-export" href={exportHref} download>
          {t(DEFAULT_LOCALE, "reach.export")}
        </a>
      </div>

      <ReachFilterBar from={from} to={to} sort={sort} />

      {top.length === 0 ? (
        <p className="reach-empty">{t(DEFAULT_LOCALE, "reach.empty")}</p>
      ) : (
        <div className="reach-table-wrap">
          <table className="reach-table">
            <thead>
              <tr>
                <th>{t(DEFAULT_LOCALE, "reach.colCustomer")}</th>
                <th>{t(DEFAULT_LOCALE, "reach.colEmail")}</th>
                <th>{t(DEFAULT_LOCALE, "reach.colRef")}</th>
                <th>{t(DEFAULT_LOCALE, "reach.colDescription")}</th>
                <th>{t(DEFAULT_LOCALE, "reach.colSentAt")}</th>
                <th className="reach-num">
                  {t(DEFAULT_LOCALE, "reach.colReach")}
                </th>
                <th className="reach-num">
                  {t(DEFAULT_LOCALE, "reach.colOpens")}
                </th>
                <th className="reach-num">
                  {t(DEFAULT_LOCALE, "reach.colShares")}
                </th>
              </tr>
            </thead>
            <tbody>
              {top.map((r) => (
                <tr key={r.orderId}>
                  <td>{r.customerName}</td>
                  <td className="reach-muted">{r.email ?? r.phone ?? "—"}</td>
                  <td className="reach-muted">{r.externalRef ?? "—"}</td>
                  <td className="reach-muted">{r.description ?? "—"}</td>
                  <td className="reach-muted">
                    {formatReachDate(r.sentAt) || "—"}
                  </td>
                  <td className="reach-num reach-strong">{r.reach}</td>
                  <td className="reach-num">{r.opens}</td>
                  <td className="reach-num">{r.shares}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Zahlen-Kachel (Wert + Label). `big` für die prominenten Aufruf-Zahlen. */
function Stat({
  value,
  label,
  big = false,
}: {
  value: number;
  label: string;
  big?: boolean;
}) {
  return (
    <div className={big ? "dashboard-stat dashboard-stat--big" : "dashboard-stat"}>
      <div className="dashboard-stat-value">{value}</div>
      <div className="dashboard-stat-label">{label}</div>
    </div>
  );
}

/** Eine Zeile mit Label, CSS-Balken (Breite = value/max) und Wert. */
function BarRow({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  const width = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="dashboard-bar-row">
      <span className="dashboard-bar-label">{label}</span>
      <span className="dashboard-bar-track">
        <span className="dashboard-bar-fill" style={{ width: `${width}%` }} />
      </span>
      <span className="dashboard-bar-value">{value}</span>
    </div>
  );
}
