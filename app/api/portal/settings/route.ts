import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import {
  CONTENT_LIMITS,
  RETENTION_MONTHS,
  VIDEO_SECONDS,
  asRecord,
  isDeliveryMode,
  isEmailFormat,
  isFontOption,
  isHexColor,
} from "@/lib/settings/options";

/** Trimmt einen String-Wert; leere/Nicht-String-Werte → null. */
function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Ganzzahl im erlaubten Bereich oder `null` (akzeptiert auch numerische Strings). */
function intInRange(value: unknown, min: number, max: number): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return rounded >= min && rounded <= max ? rounded : null;
}

/**
 * PATCH /api/portal/settings — speichert die Basis-Einstellungen eines Betriebs.
 *
 * ISOLATION: Der Ziel-Betrieb (`business_id`) stammt AUSSCHLIESSLICH aus
 * `getCurrentBusiness` (Session, RLS-erzwungen), NIEMALS aus dem Request-Body.
 * Geschrieben wird über den AUTHENTICATED Server-Client (RLS-Policy
 * `businesses_update`), kein `service_role`.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const business = await getCurrentBusiness();
  if (!business) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const payload = (body ?? {}) as Record<string, unknown>;

  // --- Validierung (sonst 400) ---
  const name = trimmedOrNull(payload.name);
  if (!name) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }

  if (!isHexColor(payload.primary_color) || !isHexColor(payload.secondary_color)) {
    return NextResponse.json({ error: "invalid_color" }, { status: 400 });
  }

  if (!isFontOption(payload.font)) {
    return NextResponse.json({ error: "invalid_font" }, { status: 400 });
  }

  if (!isDeliveryMode(payload.delivery_mode)) {
    return NextResponse.json({ error: "invalid_delivery_mode" }, { status: 400 });
  }

  const videoMaxSeconds = intInRange(
    payload.video_max_seconds,
    VIDEO_SECONDS.min,
    VIDEO_SECONDS.max,
  );
  if (videoMaxSeconds === null) {
    return NextResponse.json({ error: "invalid_video_seconds" }, { status: 400 });
  }

  const retentionMonths = intInRange(
    payload.retention_months,
    RETENTION_MONTHS.min,
    RETENTION_MONTHS.max,
  );
  if (retentionMonths === null) {
    return NextResponse.json({ error: "invalid_retention" }, { status: 400 });
  }

  // Booklet-Inhalt (Schritt 7b): optionale Text-/Kontaktfelder. Leer ⇒ null.
  const introTagline = trimmedOrNull(payload.intro_tagline);
  if (introTagline !== null && introTagline.length > CONTENT_LIMITS.introTagline) {
    return NextResponse.json({ error: "content_too_long" }, { status: 400 });
  }
  const outroMessage = trimmedOrNull(payload.outro_message);
  if (outroMessage !== null && outroMessage.length > CONTENT_LIMITS.outroMessage) {
    return NextResponse.json({ error: "content_too_long" }, { status: 400 });
  }
  const contactPhone = trimmedOrNull(payload.contact_phone);
  if (contactPhone !== null && contactPhone.length > CONTENT_LIMITS.contactPhone) {
    return NextResponse.json({ error: "content_too_long" }, { status: 400 });
  }
  const contactEmail = trimmedOrNull(payload.contact_email);
  if (contactEmail !== null && !isEmailFormat(contactEmail)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  // Betriebs-KI-Kontext (Schritt 8a-1b): Fach-/Stilkontext, erdet die
  // KI-Textgenerierung (aktuell Intro). KONTEXT, keine Anweisung. Leer ⇒ null.
  const aiContext = trimmedOrNull(payload.ai_context);
  if (aiContext !== null && aiContext.length > CONTENT_LIMITS.aiContext) {
    return NextResponse.json({ error: "content_too_long" }, { status: 400 });
  }

  // READ-MERGE-WRITE des branding-jsonb: nur die 5a-Form-Felder schreiben,
  // `logo_url` (und evtl. weitere Keys) BEIBEHALTEN. Das Logo wird ausschließlich
  // über /api/portal/settings/logo gepflegt — symmetrische Trennung, dieser
  // Handler fasst logo_url NIE an (sonst würde Speichern das Logo wegschreiben).
  const { data: current, error: readError } = await supabase
    .from("businesses")
    .select("branding, settings")
    .eq("id", business.id)
    .single<{ branding: unknown; settings: unknown }>();
  if (readError || !current) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  const branding = {
    ...asRecord(current.branding),
    primary_color: payload.primary_color,
    secondary_color: payload.secondary_color,
    font: payload.font,
    logo_per_page: payload.logo_per_page === true,
  };
  // READ-MERGE-WRITE auch auf settings: bestehende (evtl. künftige) Keys
  // beibehalten, nur die von der Form geführten Felder überschreiben.
  const settings = {
    ...asRecord(current.settings),
    video_max_seconds: videoMaxSeconds,
    ig_handle: trimmedOrNull(payload.ig_handle),
    google_review_url: trimmedOrNull(payload.google_review_url),
    website_url: trimmedOrNull(payload.website_url),
    delivery_mode: payload.delivery_mode,
    intro_tagline: introTagline,
    outro_message: outroMessage,
    contact_email: contactEmail,
    contact_phone: contactPhone,
    ai_context: aiContext,
  };

  const { data, error } = await supabase
    .from("businesses")
    .update({
      name,
      branding,
      settings,
      retention_months: retentionMonths,
    })
    .eq("id", business.id)
    .select("name, branding, settings, retention_months")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json(data, { status: 200 });
}
