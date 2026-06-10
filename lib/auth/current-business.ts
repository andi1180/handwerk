import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_BRANDING,
  RETENTION_MONTHS,
  VIDEO_SECONDS,
  isDeliveryMode,
  isFontOption,
  isHexColor,
  type DeliveryMode,
  type FontOption,
} from "@/lib/settings/options";

/** Branding eines Betriebs (aus `businesses.branding` jsonb; logo_url folgt 5b). */
export type BusinessBranding = {
  primary_color: string;
  secondary_color: string;
  font: FontOption;
  logo_per_page: boolean;
};

/** Betriebs-Einstellungen (aus `businesses.settings` jsonb). */
export type BusinessSettings = {
  video_max_seconds: number;
  ig_handle: string | null;
  google_review_url: string | null;
  website_url: string | null;
  delivery_mode: DeliveryMode;
};

/**
 * Der Betrieb (Mandant) des aktuell eingeloggten Nutzers, soweit für die
 * Portal-Shell + Settings benötigt. Erweiterbar, sobald weitere Felder
 * gebraucht werden.
 */
export type CurrentBusiness = {
  id: string;
  name: string;
  default_language: string;
  status: string;
  branding: BusinessBranding;
  settings: BusinessSettings;
  retention_months: number;
};

/** Rohzeile, wie sie von Supabase kommt — jsonb-Felder sind hier noch `unknown`. */
type BusinessRow = {
  id: string;
  name: string;
  default_language: string;
  status: string;
  branding: unknown;
  settings: unknown;
  retention_months: number | null;
};

/** jsonb → Objekt (alles andere → leeres Objekt), damit Zugriffe sicher sind. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

/** Getrimmter String oder `null` (für optionale Link-/Handle-Felder). */
function asTrimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Branding mit sinnvollen Defaults + Clamping ungültiger Werte. */
function normalizeBranding(raw: unknown): BusinessBranding {
  const b = asRecord(raw);
  return {
    primary_color: isHexColor(b.primary_color)
      ? b.primary_color
      : DEFAULT_BRANDING.primary_color,
    secondary_color: isHexColor(b.secondary_color)
      ? b.secondary_color
      : DEFAULT_BRANDING.secondary_color,
    font: isFontOption(b.font) ? b.font : DEFAULT_BRANDING.font,
    logo_per_page:
      typeof b.logo_per_page === "boolean"
        ? b.logo_per_page
        : DEFAULT_BRANDING.logo_per_page,
  };
}

/** Settings mit sinnvollen Defaults + Clamping (z. B. video_max_seconds ?? 20). */
function normalizeSettings(raw: unknown): BusinessSettings {
  const s = asRecord(raw);
  const rawVideo = s.video_max_seconds;
  const video =
    typeof rawVideo === "number" && Number.isFinite(rawVideo)
      ? Math.min(
          Math.max(Math.round(rawVideo), VIDEO_SECONDS.min),
          VIDEO_SECONDS.max,
        )
      : VIDEO_SECONDS.default;

  return {
    video_max_seconds: video,
    ig_handle: asTrimmedOrNull(s.ig_handle),
    google_review_url: asTrimmedOrNull(s.google_review_url),
    website_url: asTrimmedOrNull(s.website_url),
    delivery_mode: isDeliveryMode(s.delivery_mode) ? s.delivery_mode : "manual",
  };
}

/**
 * Löst serverseitig den Betrieb des eingeloggten Nutzers auf — ausschließlich
 * über den AUTHENTICATED Server-Client (RLS-erzwungen, KEIN service_role).
 *
 * Ablauf: auth.getUser() → eigene Zeile in `business_users` (RLS: user sieht
 * nur eigene Mitgliedschaft) → zugehörige `businesses`-Row (RLS: member-Policy).
 * `branding`/`settings` (jsonb) werden mit Defaults normalisiert. Gibt `null`
 * zurück, wenn kein User, keine Mitgliedschaft oder kein Betrieb.
 */
export async function getCurrentBusiness(): Promise<CurrentBusiness | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from("business_users")
    .select("business_id")
    .eq("user_id", user.id)
    .maybeSingle<{ business_id: string }>();
  if (!membership) return null;

  const { data: business } = await supabase
    .from("businesses")
    .select("id, name, default_language, status, branding, settings, retention_months")
    .eq("id", membership.business_id)
    .maybeSingle<BusinessRow>();
  if (!business) return null;

  return {
    id: business.id,
    name: business.name,
    default_language: business.default_language,
    status: business.status,
    branding: normalizeBranding(business.branding),
    settings: normalizeSettings(business.settings),
    retention_months:
      typeof business.retention_months === "number"
        ? business.retention_months
        : RETENTION_MONTHS.default,
  };
}
