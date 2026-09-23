import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { TIER_NAMES, isTierName, type TierName } from "@/lib/entitlements/model";

/**
 * PATCH /api/admin/businesses/[id]/tier — „Tier setzen" (Arbeitspaket A4b-1).
 *
 * Setzt AUSSCHLIESSLICH `businesses.tier` eines Betriebs. `subscription_status`,
 * `entitlement_overrides`, `trial_ends_at`, `current_period_end`,
 * `stripe_subscription_id` und `status` bleiben unberührt — „sperren" (A4b-2)
 * und Obergrenzen (A4b-3) sind eigene Schritte.
 *
 * Vertrag:
 *  - `[id]` = `businesses.id` (uuid), ungültiges Format ⇒ 400 `invalid_id`
 *  - Body EXAKT `{ tier: string | null }` — jedes weitere Feld ⇒ 400
 *    `unexpected_fields` (bewusst strikt statt „unbekannte ignorieren", damit
 *    dieser Endpunkt nie still zum Einfallstor für andere `businesses`-Spalten
 *    wird: ein später versehentlich durchgereichtes Feld fällt sofort auf)
 *  - `tier` muss `null` oder einer der `TIER_NAMES` sein ⇒ sonst 400
 *    `invalid_tier` (+ `allowed`)
 *  - Betrieb existiert nicht ⇒ 404 `not_found`
 *  - Erfolg ⇒ 200 `{ id, tier }`, DB-Fehler ⇒ 500 (kein leerer Erfolg)
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // ZUGRIFFSSCHUTZ ALS ERSTES — im Handler selbst: ein Route Handler hat kein
  // Layout, das ihn umschließt (app/admin/layout.tsx greift hier NICHT).
  // Bestandsmuster wie getCurrentBusiness() in /api/portal/*: kein User ⇒
  // redirect('/login') (307), kein Admin ⇒ notFound() (404). Bis zur Validierung
  // und zum Update unten kommt nur ein Nutzer aus `platform_admins`.
  await requirePlatformAdmin();

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // Strikt: genau ein Key, und der heißt `tier`.
  const keys = Object.keys(payload);
  const extra = keys.filter((k) => k !== "tier");
  if (extra.length > 0) {
    return NextResponse.json(
      { error: "unexpected_fields", fields: extra },
      { status: 400 },
    );
  }
  if (!keys.includes("tier")) {
    return NextResponse.json({ error: "missing_tier" }, { status: 400 });
  }

  const rawTier: unknown = (payload as Record<string, unknown>).tier;
  let tier: TierName | null;
  if (rawTier === null) {
    tier = null;
  } else if (isTierName(rawTier)) {
    tier = rawTier;
  } else {
    return NextResponse.json(
      {
        error: "invalid_tier",
        message: `tier muss null oder einer von ${TIER_NAMES.join(", ")} sein`,
        allowed: [null, ...TIER_NAMES],
      },
      { status: 400 },
    );
  }

  // ⚠️ service_role ist hier der EINZIGE legitime Schreibweg für `tier`:
  // `authenticated` hat seit Migration 0020 (A1-Fix) absichtlich KEIN
  // UPDATE-Recht auf diese Spalte — das ist die vorgesehene Absicherung gegen
  // „Betrieb setzt sich selbst auf ein höheres Tier", kein Bug. Sicher, weil
  // `requirePlatformAdmin()` oben alle Nicht-Admins vorher abweist.
  // Geschrieben wird NUR `tier`, gezielt auf genau diese id.
  const service = createServiceClient();
  const { data, error } = await service
    .from("businesses")
    .update({ tier })
    .eq("id", id)
    .select("id, tier")
    .maybeSingle<{ id: string; tier: string | null }>();

  if (error) {
    console.error("admin: set tier failed", {
      business_id: id,
      step: "update",
      message: error.message,
    });
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ id: data.id, tier: data.tier });
}
