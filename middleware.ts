import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session-Refresh (Standard-@supabase/ssr-updateSession-Pattern) + Schutz
 * von /portal/*. Läuft bei jedem Request, hält die Auth-Cookies frisch und
 * leitet nicht eingeloggte Nutzer von geschützten Routen auf /login um.
 */
export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // WICHTIG: Zwischen createServerClient und getUser keinen Code ausführen,
  // sonst können schwer auffindbare Session-Bugs entstehen.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Geschützte Portal-Routen: ohne Session zurück zum Login.
  if (!user && request.nextUrl.pathname.startsWith("/portal")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Self-Service-Registrierung (Option C): pending-Betriebe sind gesperrt. Für
  // eingeloggte Nutzer auf Portal-SEITEN den Status prüfen und nach /pending
  // umleiten. getCurrentBusiness erzwingt dasselbe als Fallback (und deckt die
  // /api/portal/*-Routen ab, die hier nicht unter /portal fallen). /pending und
  // /register liegen außerhalb /portal ⇒ keine Schleife. FAIL-SAFE: fehlt oder
  // erroriert die Abfrage, wird NICHT umgeleitet (das Layout prüft erneut).
  if (user && request.nextUrl.pathname.startsWith("/portal")) {
    const { data: row } = await supabase
      .from("business_users")
      .select("businesses(status)")
      .eq("user_id", user.id)
      .maybeSingle<{
        businesses: { status: string } | { status: string }[] | null;
      }>();
    const biz = row?.businesses;
    const status = Array.isArray(biz) ? biz[0]?.status : biz?.status;
    if (status === "pending") {
      const url = request.nextUrl.clone();
      url.pathname = "/pending";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Alle Pfade außer statischen Assets:
     * _next/static, _next/image, favicon.ico und gängige Bildformate.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
