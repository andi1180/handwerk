import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { mergeBranding } from "@/lib/settings/branding-store";

/** Fixer Storage-Pfad des Logos (erstes Segment = business_id = Isolations-Grenze). */
function logoStoragePath(businessId: string): string {
  return `${businessId}/logo.png`;
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

  const result = await mergeBranding(supabase, business.id, {
    logo_url: expected,
  });
  if (!result) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  return NextResponse.json(result, { status: 200 });
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

  const result = await mergeBranding(supabase, business.id, { logo_url: null });
  if (!result) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  return NextResponse.json(result, { status: 200 });
}
