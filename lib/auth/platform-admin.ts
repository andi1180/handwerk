/**
 * Die Frage „ist dieser Nutzer Plattform-Admin?" (Arbeitspaket A3).
 *
 * `platform_admins` (Migration 0023) ist eine eigene, globale Rolle —
 * ausdrücklich NICHT `business_users.role`: diese Tabelle ist strukturell an
 * EINEN Betrieb gebunden (`business_id` + `role`), ein Plattform-Admin soll
 * aber ALLE Betriebe sehen, ohne je Kundenbetrieb eine Mitgliedschaftszeile
 * zu brauchen (ROLLOUT_PFLICHTENHEFT.md §4.2).
 *
 * NOCH KEIN AUFRUFER — die Verdrahtung (Admin-Backoffice) ist A4.
 */
import type { createClient } from "@/lib/supabase/server";

/**
 * Authentifizierter Server-Supabase-Client (RLS-erzwungen, KEIN `service_role`)
 * — dasselbe Muster wie `lib/entitlements/load.ts`.
 *
 * **Vertrag mit dem Aufrufer (Isolationsregel §14.2):** dieses Modul erzeugt
 * selbst KEINEN Client und liest NIE aus Cookies/Session. Client UND `userId`
 * kommen von außen; die `userId` MUSS beim Aufrufer aus der Session stammen.
 */
type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Prüft, ob `userId` in `platform_admins` steht.
 *
 * Die RLS-Policy aus 0023 beschränkt die sichtbaren Zeilen ohnehin auf
 * `user_id = auth.uid()` — der Parameter ist defensiv (explizit statt implizit),
 * **kein** Sicherheitsmechanismus für sich.
 *
 * Fail-safe heißt hier „kein Zugriff bei Unsicherheit", nicht „Fehler
 * verschlucken": keine Zeile ⇒ `false`; ein echter Datenbankfehler wirft
 * normal weiter, statt still zu `false` (oder gar `true`) zu werden.
 */
export async function isPlatformAdmin(
  supabase: ServerClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`platform_admin lookup failed: ${error.message}`);
  }

  return data !== null;
}
