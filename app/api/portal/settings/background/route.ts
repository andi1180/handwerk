import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { mergeBranding } from "@/lib/settings/branding-store";
import {
  backgroundStoragePath,
  isBackgroundSlot,
  type BackgroundSlot,
} from "@/lib/settings/options";

/** branding-jsonb-Key je Hintergrund-Slot. */
function brandingKey(slot: BackgroundSlot): "intro_bg_url" | "outro_bg_url" {
  return slot === "intro" ? "intro_bg_url" : "outro_bg_url";
}

/** Liest und validiert den `slot` aus dem JSON-Body (sonst null). */
async function readSlot(request: Request): Promise<BackgroundSlot | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  const payload = (body ?? {}) as Record<string, unknown>;
  return isBackgroundSlot(payload.slot) ? payload.slot : null;
}

/**
 * POST /api/portal/settings/background — verankert ein zuvor (BROWSER-Client)
 * direkt in den privaten Bucket `branding` geladenes Hintergrundbild im
 * branding-jsonb (Intro- ODER Outro-Slot).
 *
 * ISOLATION: `business_id` stammt AUSSCHLIESSLICH aus der Session
 * (`getCurrentBusiness`), NIE aus dem Body. Der mitgeschickte `storage_path` muss
 * exakt `${business_id}/${slot}-bg.jpg` sein (sonst 400) — die Storage-RLS aus
 * 0003 hätte einen fremden Pfad ohnehin schon beim Upload abgelehnt.
 * READ-MERGE-WRITE: nur der Key dieses Slots wird gesetzt; logo_url, Farben,
 * font, logo_per_page und der andere Slot bleiben unangetastet.
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

  if (!isBackgroundSlot(payload.slot)) {
    return NextResponse.json({ error: "invalid_slot" }, { status: 400 });
  }
  const slot = payload.slot;

  const expected = backgroundStoragePath(business.id, slot);
  if (
    typeof payload.storage_path !== "string" ||
    payload.storage_path !== expected
  ) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  const result = await mergeBranding(supabase, business.id, {
    [brandingKey(slot)]: expected,
  });
  if (!result) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  return NextResponse.json(result, { status: 200 });
}

/**
 * DELETE /api/portal/settings/background — entfernt einen Hintergrund: erst die
 * Datei aus dem Storage (Delete-Policy bindet das erste Pfad-Segment an die
 * business_id), dann den slot-Key per READ-MERGE-WRITE auf null. ISOLATION wie
 * POST; der `slot` kommt aus dem JSON-Body.
 */
export async function DELETE(request: Request) {
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

  const slot = await readSlot(request);
  if (!slot) {
    return NextResponse.json({ error: "invalid_slot" }, { status: 400 });
  }

  const path = backgroundStoragePath(business.id, slot);
  const { error: removeError } = await supabase.storage
    .from("branding")
    .remove([path]);
  if (removeError) {
    // Nicht hart abbrechen — die branding-Referenz ist die UI-Quelle der Wahrheit;
    // ein evtl. zurückbleibendes File wird beim nächsten Upload (upsert) überschrieben.
    console.error(
      `[background] Storage-Remove fehlgeschlagen (business ${business.id}, slot ${slot}):`,
      removeError,
    );
  }

  const result = await mergeBranding(supabase, business.id, {
    [brandingKey(slot)]: null,
  });
  if (!result) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  return NextResponse.json(result, { status: 200 });
}
