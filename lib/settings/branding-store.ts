import type { createClient } from "@/lib/supabase/server";
import { asRecord } from "@/lib/settings/options";

/**
 * READ-MERGE-WRITE des `businesses.branding`-jsonb (server-only).
 *
 * Mergt die übergebenen Keys in das bestehende Objekt und lässt alle anderen
 * Keys (Farben, font, logo_per_page, logo_url, intro_bg_url, outro_bg_url …)
 * unangetastet. Geteilt von den Branding-Endpoints (Logo 7a, Hintergründe 7c),
 * damit das Merge-Muster nicht dupliziert wird und jeder Endpoint nur seine
 * eigenen Felder anfasst (sonst würde ein Endpoint die Werte eines anderen
 * wegschreiben). AUTHENTICATED Client (RLS-Policy `businesses_update`) — die
 * `business_id` MUSS aus der Session stammen, nie aus dem Request-Body.
 *
 * Gibt das neue `{ branding }` zurück oder `null` bei DB-Fehler.
 */
export async function mergeBranding(
  supabase: Awaited<ReturnType<typeof createClient>>,
  businessId: string,
  patch: Record<string, string | null>,
): Promise<{ branding: unknown } | null> {
  const { data: current, error: readError } = await supabase
    .from("businesses")
    .select("branding")
    .eq("id", businessId)
    .single<{ branding: unknown }>();
  if (readError || !current) return null;

  const branding = { ...asRecord(current.branding), ...patch };

  const { data, error } = await supabase
    .from("businesses")
    .update({ branding })
    .eq("id", businessId)
    .select("branding")
    .single();
  if (error || !data) return null;
  return data;
}
