import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { DEFAULT_LOCALE, t, type Locale } from "@/lib/i18n";
import { bookletFontClass } from "@/lib/booklet/fonts";
import { displayCaption } from "@/lib/booklet/caption";
import { isCustomerViewParam } from "@/lib/booklet/customer-view";
import { bookletShareLink } from "@/lib/booklet/share-link";
import {
  loadPublicBooklet,
  type PublicBookletData,
  type PublicBookletMedia,
} from "@/lib/booklet/load";
import { ShareBar } from "./share-bar";
import { ViewTracker } from "./view-tracker";
import { TrackedLink } from "./tracked-link";
import "./booklet.css";

/* Pro Request frisch rendern — die Signed-URLs sind kurzlebig, nichts cachen. */
export const dynamic = "force-dynamic";

/**
 * Öffentliche Web-Story /b/[token] (Schritt 8a-2). Server Component, mobile-first.
 *
 * SICHERHEIT (§14.2): Die Daten kommen ausschließlich über `loadPublicBooklet`
 * (service_role, kein anon-SELECT). Der TOKEN aus der URL ist die einzige
 * vertrauenswürdige Quelle: token → booklets-Row → business_id; alle weiteren
 * Reads sind dort strikt darauf gescoped. Diese Route liegt NICHT unter /portal,
 * der Middleware-Guard greift also nicht — die Seite ist öffentlich erreichbar.
 *
 * Komposition: Vollbild-Scroll-Story (scroll-snap, je Sektion 100dvh):
 * Intro → eine Sektion pro Medium (sort_order) → Outro. KEIN View-/Analytics-
 * Tracking (Step 9/10).
 *
 * KUNDEN- vs. EMPFÄNGER-SICHT (§9d): Der URL-Marker `?c=1` (searchParams)
 * schaltet die Teilen-Sektion EIN — NUR auf dem ausgelieferten Kunden-Link.
 * Der nackte Link (`/b/[token]`, den der Kunde teilt) zeigt das normale Outro
 * OHNE Teilen-Schicht. Der Marker ist KEIN Auth-Gate (der Token bleibt der
 * alleinige Zugriffsschutz, §14.2) — er schaltet ausschließlich UI.
 */
export default async function PublicBookletPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const isCustomerView = isCustomerViewParam(await searchParams);
  const result = await loadPublicBooklet(token);

  if (result.status === "not_found") notFound();
  if (result.status === "expired") return <ExpiredView />;

  const data = result.data;
  // Feste Labels folgen booklet.language; dynamischer Text kommt sprachfertig
  // aus der DB. Der i18n-Layer kennt aktuell nur 'de' → unbekannt ⇒ Default.
  const locale = (["de"] as const).find((l) => l === data.language) ?? DEFAULT_LOCALE;

  // Kanonische absolute Story-URL fürs Teilen (Block C: kurzer `/s/<code>`,
  // Fallback langer `/b/<token>` für alte Booklets ohne Code). Bewusst die NACKTE
  // URL OHNE Marker (customerView=false): so landet jeder Empfänger automatisch in
  // der Empfänger-Sicht (§9d) — der Redirect reicht das Fehlen des Markers durch.
  // Auf Vercel liefern die x-forwarded-*-Header Host/Protokoll; force-dynamic.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const storyUrl = bookletShareLink({
    base: `${proto}://${host}`,
    accessToken: token,
    shortCode: data.shortCode,
    customerView: false,
  });

  // Branding-Farben als CSS-Variablen an den Story-Wurzel-Container.
  const rootStyle = {
    "--bk-primary": data.branding.primary_color,
    "--bk-secondary": data.branding.secondary_color,
  } as React.CSSProperties;

  return (
    <div
      className={`booklet ${bookletFontClass(data.branding.font)}`}
      style={rootStyle}
    >
      {/* Analytics (10a): feuert beim Mount EINMALIG `viewed` — für ALLE Öffner
          (Kunde UND Empfänger), unabhängig von `?c=1`. Reichweite zählt. */}
      <ViewTracker token={token} />
      <main className="booklet-scroll">
        <IntroSection data={data} locale={locale} />
        {data.media.map((item) => (
          <MediaSection key={item.id} item={item} data={data} />
        ))}
        <OutroSection
          data={data}
          locale={locale}
          token={token}
          storyUrl={storyUrl}
          reelSignedUrl={data.reelSignedUrl}
          isCustomerView={isCustomerView}
        />
      </main>
    </div>
  );
}

/* --- Intro --- */

function IntroSection({
  data,
  locale,
}: {
  data: PublicBookletData;
  locale: Locale;
}) {
  const title = data.introTitle ?? data.businessName;
  return (
    <section className="booklet-section">
      {data.introBgUrl ? (
        <img className="booklet-bg" src={data.introBgUrl} alt="" />
      ) : (
        <div className="booklet-bg--fallback" aria-hidden />
      )}
      <div className="booklet-scrim" aria-hidden />

      <div className="booklet-content">
        {data.logoUrl ? (
          <img
            className="booklet-logo"
            src={data.logoUrl}
            alt={data.businessName}
          />
        ) : null}
        <h1 className="booklet-title">{title}</h1>
        <div className="booklet-accent" aria-hidden />
        {data.introDescription ? (
          <p className="booklet-desc">{data.introDescription}</p>
        ) : null}
        {data.settings.intro_tagline ? (
          <p className="booklet-tagline">{data.settings.intro_tagline}</p>
        ) : null}
      </div>

      <div
        className="booklet-scroll-hint"
        aria-label={t(locale, "booklet.scrollHint")}
      >
        <ChevronDownIcon />
      </div>
    </section>
  );
}

/* --- Medium (Foto/Video) --- */

function MediaSection({
  item,
  data,
}: {
  item: PublicBookletMedia;
  data: PublicBookletData;
}) {
  // Overlay-Text: caption ?? keyword; beide leer ⇒ kein Overlay, kein Scrim.
  const caption = displayCaption(item);
  const showLogo = data.branding.logo_per_page && data.logoUrl;

  return (
    <section className="booklet-section">
      {item.signedUrl ? (
        item.media_type === "video" ? (
          // KEIN Auto-Play im MVP — Tap zum Abspielen (kein IntersectionObserver
          // auf der öffentlichen Seite). Poster-Frame via #t-Fragment.
          <video
            className="booklet-bg booklet-video"
            src={`${item.signedUrl}#t=0.1`}
            controls
            playsInline
            preload="metadata"
          />
        ) : (
          // Foto statisch full-bleed (Ken-Burns ist Sache des Reels, 8b).
          <img className="booklet-bg" src={item.signedUrl} alt={caption ?? ""} />
        )
      ) : (
        <div className="booklet-bg--fallback" aria-hidden />
      )}

      {showLogo ? (
        <img
          className="booklet-page-logo"
          src={data.logoUrl ?? undefined}
          alt={data.businessName}
        />
      ) : null}

      {caption ? (
        <>
          <div className="booklet-caption-scrim" aria-hidden />
          <div className="booklet-caption">
            <p>{caption}</p>
          </div>
        </>
      ) : null}
    </section>
  );
}

/* --- Outro --- */

function OutroSection({
  data,
  locale,
  token,
  storyUrl,
  reelSignedUrl,
  isCustomerView,
}: {
  data: PublicBookletData;
  locale: Locale;
  token: string;
  storyUrl: string;
  reelSignedUrl: string | null;
  isCustomerView: boolean;
}) {
  const { contact_email, contact_phone, website_url } = data.settings;
  const hasContact = Boolean(contact_email || contact_phone || website_url);

  return (
    <section className="booklet-section booklet-section--outro">
      {data.outroBgUrl ? (
        <img className="booklet-bg" src={data.outroBgUrl} alt="" />
      ) : (
        <div className="booklet-bg--fallback" aria-hidden />
      )}
      <div className="booklet-scrim" aria-hidden />

      <div className="booklet-content">
        {data.logoUrl ? (
          <img
            className="booklet-logo"
            src={data.logoUrl}
            alt={data.businessName}
          />
        ) : null}
        <h2 className="booklet-outro-name">{data.businessName}</h2>
        {data.settings.outro_message ? (
          <p className="booklet-outro-message">{data.settings.outro_message}</p>
        ) : null}

        {/* §9d: Teilen-Sektion (+ IG-Caption + Review) NUR in der Kunden-Sicht
            (markierter Link `?c=1`). Empfänger des nackten Links sehen das
            normale Settings-Outro ohne Teilen-Schicht. */}
        {isCustomerView ? (
          <ShareBar
            token={token}
            storyUrl={storyUrl}
            reelSignedUrl={reelSignedUrl}
            reviewDraft={data.reviewDraft}
            googleReviewUrl={data.settings.google_review_url}
            igCaption={data.igCaption}
            locale={locale}
          />
        ) : null}

        {hasContact ? (
          <div className="booklet-contact">
            {contact_email ? (
              <a
                href={`mailto:${contact_email}`}
                aria-label={`${t(locale, "booklet.contactEmail")}: ${contact_email}`}
              >
                <MailIcon />
                <span>{contact_email}</span>
              </a>
            ) : null}
            {contact_phone ? (
              <a
                href={`tel:${contact_phone.replace(/\s+/g, "")}`}
                aria-label={`${t(locale, "booklet.contactPhone")}: ${contact_phone}`}
              >
                <PhoneIcon />
                <span>{contact_phone}</span>
              </a>
            ) : null}
            {website_url ? (
              // §10a: Outro-Website-Klick → link_click/website (für alle Öffner).
              <TrackedLink
                token={token}
                channel="website"
                href={externalHref(website_url)}
                ariaLabel={`${t(locale, "booklet.contactWebsite")}: ${displayHost(website_url)}`}
              >
                <GlobeIcon />
                <span>{displayHost(website_url)}</span>
              </TrackedLink>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* --- „nicht mehr verfügbar"-Seite --- */

function ExpiredView() {
  return (
    <div className="booklet">
      <div className="booklet-simple">
        <h1>{t(DEFAULT_LOCALE, "booklet.expiredTitle")}</h1>
        <p>{t(DEFAULT_LOCALE, "booklet.expiredText")}</p>
      </div>
    </div>
  );
}

/* --- Helfer --- */

/** Externer Link bekommt ein Protokoll, falls der Betrieb keins gesetzt hat. */
function externalHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** Anzeige-Form der Website (ohne Protokoll/Trailing-Slash). */
function displayHost(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/* --- Icons (rein dekorativ, currentColor) --- */

function ChevronDownIcon() {
  return (
    <svg
      width={26}
      height={26}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
