import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/** Die Spalten, die die Betriebsliste zeigt (kein Join, keine Auftragszahlen). */
type AdminBusinessRow = {
  id: string;
  name: string;
  business_email: string;
  status: string;
  tier: string | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  created_at: string;
};

/**
 * Betriebsliste des Admin-Backoffice (A4a) — rein lesend.
 *
 * Alle Betriebe, neueste zuerst: frische `pending`-Registrierungen fallen so
 * sofort oben ins Auge (Freischaltung selbst bleibt vorerst Hand-SQL; „Tier
 * setzen", „sperren", Obergrenzen = A4b).
 */
export default async function AdminBusinessesPage() {
  // ZUGRIFFSSCHUTZ VOR DER QUERY. Das Layout hat dieselbe Prüfung schon gemacht
  // (per `cache()` hier ohne zweiten Lookup) — die Seite verlässt sich aber
  // NICHT darauf, weil ein Layout beim Teil-Rendern übersprungen werden kann.
  // Ohne Admin-Rolle kommt die Ausführung nie bis zur Query unten (404/Login).
  await requirePlatformAdmin();

  // ⚠️ BEWUSSTE AUSNAHME von der Isolationsregel „business_id ausschließlich aus
  // der Session" (§14.2): diese Query ist ABSICHTLICH betriebsübergreifend und
  // läuft deshalb über `service_role`. Der AUTHENTICATED Client würde über die
  // `businesses_select`-Policy (0001, „nur Mitglieder") auf genau den einen
  // Betrieb filtern, dem der Admin selbst angehört — hier also falsch.
  // Sicher ist das, weil der Schutz nicht IN der Query liegt (die ist bewusst
  // ungefiltert), sondern DAVOR: `requirePlatformAdmin()` oben lässt nur
  // Nutzer aus `platform_admins` durch. Rein lesend, feste Spaltenliste — keine
  // Secrets (`webhook_secret`, `website_pull_secret`) und keine
  // Branding/Settings-Blobs.
  const service = createServiceClient();
  const { data, error } = await service
    .from("businesses")
    .select(
      "id, name, business_email, status, tier, subscription_status, trial_ends_at, current_period_end, created_at",
    )
    .order("created_at", { ascending: false })
    .returns<AdminBusinessRow[]>();

  if (error) {
    console.error("admin: businesses list failed", { message: error.message });
  }
  const businesses = data ?? [];

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h1 className="admin-page-title">
          {t(DEFAULT_LOCALE, "admin.businesses.title")}
        </h1>
        {!error ? (
          <span className="admin-page-count">
            {t(DEFAULT_LOCALE, "admin.businesses.count", {
              count: businesses.length,
            })}
          </span>
        ) : null}
      </div>
      <p className="admin-page-hint">
        {t(DEFAULT_LOCALE, "admin.businesses.hint")}
      </p>

      <div className="card admin-card">
        {error ? (
          <p className="admin-empty">
            {t(DEFAULT_LOCALE, "admin.businesses.loadError")}
          </p>
        ) : businesses.length === 0 ? (
          <p className="admin-empty">
            {t(DEFAULT_LOCALE, "admin.businesses.empty")}
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t(DEFAULT_LOCALE, "admin.businesses.colName")}</th>
                <th>{t(DEFAULT_LOCALE, "admin.businesses.colEmail")}</th>
                <th>{t(DEFAULT_LOCALE, "admin.businesses.colStatus")}</th>
                <th>{t(DEFAULT_LOCALE, "admin.businesses.colTier")}</th>
                <th>{t(DEFAULT_LOCALE, "admin.businesses.colSubscription")}</th>
                <th>{t(DEFAULT_LOCALE, "admin.businesses.colTrialEnds")}</th>
                <th>{t(DEFAULT_LOCALE, "admin.businesses.colPeriodEnd")}</th>
                <th>{t(DEFAULT_LOCALE, "admin.businesses.colCreated")}</th>
              </tr>
            </thead>
            <tbody>
              {businesses.map((b) => (
                <tr key={b.id}>
                  <td className="admin-strong">{b.name}</td>
                  <td>{b.business_email}</td>
                  <td>
                    <BusinessStatusBadge status={b.status} />
                  </td>
                  <td>
                    <Plain value={b.tier} />
                  </td>
                  <td>
                    <Plain value={b.subscription_status} />
                  </td>
                  <td>
                    <Plain value={formatDate(b.trial_ends_at)} />
                  </td>
                  <td>
                    <Plain value={formatDate(b.current_period_end)} />
                  </td>
                  <td>{formatDate(b.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/**
 * Datum TT.MM.JJJJ in Wiener Zeit. Bewusst mit Zeitzone: `trial_ends_at` /
 * `current_period_end` liegen typischerweise auf Mitternacht Ortszeit — in UTC
 * (Vercel-Serverzeit) formatiert, zeigte die Liste sonst den Vortag.
 */
const DATE_FMT = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Vienna",
});

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : DATE_FMT.format(d);
}

/** Roher Wert als Text, `null` ⇒ gedämpfter Strich. */
function Plain({ value }: { value: string | null }) {
  return value ? <>{value}</> : <span className="admin-muted">—</span>;
}

type BadgeStyle = { background: string; border: string; color: string };

/**
 * Farben für `businesses.status` aus dem bestehenden Token-System (keine neue
 * Palette): pending = amber (braucht Aufmerksamkeit), active = grün,
 * suspended = rot.
 */
const BUSINESS_STATUS_STYLES = {
  pending: {
    background: "var(--amber-light)",
    border: "var(--amber-border)",
    color: "var(--amber-text)",
  },
  active: {
    background: "var(--green-light)",
    border: "var(--green-border)",
    color: "var(--green-text)",
  },
  suspended: {
    background: "var(--red-light)",
    border: "var(--red-border)",
    color: "var(--red-text)",
  },
} satisfies Record<string, BadgeStyle>;

type BusinessStatus = keyof typeof BUSINESS_STATUS_STYLES;

function isBusinessStatus(value: string): value is BusinessStatus {
  return Object.hasOwn(BUSINESS_STATUS_STYLES, value);
}

/**
 * Status-Pill für `businesses.status` (Optik wie `OrderStatusBadge`). Ein Wert
 * außerhalb der DB-Check-Constraint (defensiv) erscheint roh und neutral.
 */
function BusinessStatusBadge({ status }: { status: string }) {
  const known = isBusinessStatus(status);
  const style: BadgeStyle = known
    ? BUSINESS_STATUS_STYLES[status]
    : {
        background: "var(--surface)",
        border: "var(--border)",
        color: "var(--text-secondary)",
      };
  const label = known
    ? t(DEFAULT_LOCALE, `admin.businessStatus.${status}`)
    : status;
  return (
    <span
      className="admin-status-badge"
      style={{
        background: style.background,
        border: `1px solid ${style.border}`,
        color: style.color,
      }}
    >
      {label}
    </span>
  );
}
