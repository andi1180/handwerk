import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { getBusinessLogoUrl } from "@/lib/branding/logo";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import type { OrderStatus } from "@/components/order-status-badge";

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
export default async function PortalDashboardPage() {
  const business = await getCurrentBusiness();
  if (!business) return null;

  const supabase = await createClient();

  const countOrders = async (statuses: OrderStatus[]): Promise<number> => {
    const { count } = await supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("business_id", business.id)
      .in("status", statuses);
    return count ?? 0;
  };

  const [delivered, viewedCount, sharedCount, eventsResult, logoUrl] =
    await Promise.all([
      countOrders(["sent", "viewed", "shared"]),
      countOrders(["viewed", "shared"]),
      countOrders(["shared"]),
      supabase
        .from("booklet_events")
        .select("event_type, channel, ip_hash")
        .eq("business_id", business.id)
        .returns<EventRow[]>(),
      getBusinessLogoUrl(business),
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

  // Konsistenter Seitenkopf (analog zur „Aufträge"-Überschrift): Logo bzw.
  // Betriebsname-Fallback oben links + „Dashboard"-Titel.
  const header = (
    <div className="dashboard-head">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- signiertes Branding-Asset (privater Bucket), keine next/image-Optimierung nötig.
        <img className="dashboard-head-logo" src={logoUrl} alt={business.name} />
      ) : (
        <span className="dashboard-head-brand">{business.name}</span>
      )}
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
    </div>
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
