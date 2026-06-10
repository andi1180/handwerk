import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase-Client für den Browser (Client Components).
 * Verwendet den öffentlichen anon-Key; alle Zugriffe laufen über RLS.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
