import { createClient } from "@/lib/supabase/server";
import type { CurrentBusiness } from "@/lib/auth/current-business";

/**
 * Signiert den Logo-Pfad des Betriebs aus dem privaten `branding`-Bucket (1 h),
 * falls eines hochgeladen ist — sonst `null` (im UI fällt es dann auf den
 * Betriebsnamen zurück). Gleicher Signier-Pfad wie die Settings-Vorschau (7a),
 * aber als eine Quelle geteilt zwischen Portal-Shell (Mobile-Top-Bar) und
 * Dashboard-Kopf, damit die Logo-Logik nicht an zwei Stellen driftet.
 *
 * AUTHENTICATED Client (RLS, kein service_role) — die Storage-Policy bindet das
 * erste Pfad-Segment an die `business_id`, der Pfad stammt aus `getCurrentBusiness`.
 */
export async function getBusinessLogoUrl(
  business: Pick<CurrentBusiness, "branding">,
): Promise<string | null> {
  const path = business.branding.logo_url;
  if (!path) return null;
  const supabase = await createClient();
  const { data } = await supabase.storage
    .from("branding")
    .createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}
