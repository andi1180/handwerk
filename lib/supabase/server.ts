import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase-Client für den Server (Server Components, Route Handlers, Server Actions).
 * Authentifizierter Kontext: liest/schreibt die Session-Cookies. Zugriffe laufen über RLS.
 * Next.js 15: `cookies()` ist async und muss awaited werden.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // `setAll` aus einer Server Component aufgerufen — kann ignoriert
            // werden, wenn die Middleware die Session aktualisiert.
          }
        },
      },
    },
  );
}
