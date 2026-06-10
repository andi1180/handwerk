import { createClient } from "@/lib/supabase/server";

/**
 * Der Betrieb (Mandant) des aktuell eingeloggten Nutzers, soweit für die
 * Portal-Shell benötigt. Erweiterbar, sobald weitere Felder gebraucht werden.
 */
export type CurrentBusiness = {
  id: string;
  name: string;
  default_language: string;
  status: string;
};

/**
 * Löst serverseitig den Betrieb des eingeloggten Nutzers auf — ausschließlich
 * über den AUTHENTICATED Server-Client (RLS-erzwungen, KEIN service_role).
 *
 * Ablauf: auth.getUser() → eigene Zeile in `business_users` (RLS: user sieht
 * nur eigene Mitgliedschaft) → zugehörige `businesses`-Row (RLS: member-Policy).
 * Gibt `null` zurück, wenn kein User, keine Mitgliedschaft oder kein Betrieb.
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
    .select("id, name, default_language, status")
    .eq("id", membership.business_id)
    .maybeSingle<CurrentBusiness>();

  return business ?? null;
}
