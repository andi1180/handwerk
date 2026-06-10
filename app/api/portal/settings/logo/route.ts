import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { asRecord } from "@/lib/settings/options";

/** AUTHENTICATED Server-Client (RLS), wie ihn dieser Handler durchgängig nutzt. */
type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Fixer Storage-Pfad des Logos (erstes Segment = business_id = Isolations-Grenze). */
function logoStoragePath(businessId: string): string {
  return `${businessId}/logo.png`;
}

/**
 * READ-MERGE-WRITE des branding-jsonb: fasst NUR `logo_url` an, der Rest des
 * Objekts bleibt unangetastet (symmetrisch zu PATCH /api/portal/settings, das
 * `logo_url` nie schreibt). AUTHENTICATED Client (RLS-Policy `businesses_update`).
 * Gibt das neue branding zurück oder `null` bei DB-Fehler.
 */
async function writeLogoUrl(
  supabase: ServerClient,
  businessId: string,
  value: string | null,
) {
  const { data: current, error: readError } = await supabase
    .from("businesses")
    .select("branding")
    .eq("id", businessId)
    .single<{ branding: unknown }>();
  if (readError || !current) return null;

  const branding = { ...asRecord(current.branding), logo_url: value };

  const { data, error } = await supabase
    .from("businesses")
    .update({ branding })
    .eq("id", businessId)
    .select("branding")
    .single();
  if (error || !data) return null;
  return data;
}

/**
 * POST /api/portal/settings/logo — verankert ein zuvor (BROWSER-Client) direkt
 * in den privaten Bucket `branding` geladenes Logo im branding-jsonb.
 *
 * ISOLATION: `business_id` stammt AUSSCHLIESSLICH aus der Session
 * (`getCurrentBusiness`), NIE aus dem Body. Der mitgeschickte `storage_path` muss
 * exakt `${business_id}/logo.png` sein (sonst 400) — die Storage-RLS aus 0003
 * hätte einen fremden Pfad ohnehin schon beim Upload abgelehnt.
 */
export async function POST(request: Request) {
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

  const expected = logoStoragePath(business.id);
  if (typeof payload.storage_path !== "string" || payload.storage_path !== expected) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  const branding = await writeLogoUrl(supabase, business.id, expected);
  if (!branding) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  return NextResponse.json(branding, { status: 200 });
}

/**
 * DELETE /api/portal/settings/logo — entfernt das Logo: erst die Datei aus dem
 * Storage (Delete-Policy bindet das erste Pfad-Segment an die business_id), dann
 * `branding.logo_url` per READ-MERGE-WRITE auf null. ISOLATION wie POST.
 */
export async function DELETE() {
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

  const path = logoStoragePath(business.id);
  const { error: removeError } = await supabase.storage
    .from("branding")
    .remove([path]);
  if (removeError) {
    // Nicht hart abbrechen — die branding-Referenz ist die UI-Quelle der Wahrheit;
    // ein evtl. zurückbleibendes File wird beim nächsten Upload (upsert) überschrieben.
    console.error(
      `[logo] Storage-Remove fehlgeschlagen (business ${business.id}):`,
      removeError,
    );
  }

  const branding = await writeLogoUrl(supabase, business.id, null);
  if (!branding) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  return NextResponse.json(branding, { status: 200 });
}
