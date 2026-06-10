// Nur server-seitig. NIEMALS in Client Components importieren.
// NIEMALS mit NEXT_PUBLIC_ prefixen.
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase service_role-Client — umgeht RLS und hat vollen DB-Zugriff.
 * Ausschließlich für serverseitige Logik (z. B. öffentliche Booklet-Reads mit
 * server-seitiger access_token-Validierung, Inserts/Deletes auf `booklets`).
 */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
