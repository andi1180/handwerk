import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import LogoutButton from "./logout-button";

/**
 * Geschützte Portal-Shell (Server Component, desktop-first).
 * Auth-Check (kein User → /login), Betriebs-Auflösung (kein Betrieb →
 * freundlicher Hinweis), sonst Sidebar-Shell mit Inhalt rendern.
 */
export default async function PortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const business = await getCurrentBusiness();

  if (!business) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div className="card" style={{ maxWidth: 420, textAlign: "center" }}>
          <p style={{ margin: 0 }}>{t(DEFAULT_LOCALE, "portal.noBusiness")}</p>
        </div>
      </main>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        style={{
          width: 220,
          flexShrink: 0,
          background: "var(--sidebar-bg)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          padding: "20px 0",
        }}
      >
        <div
          style={{
            padding: "0 20px 16px",
            fontSize: 16,
            fontWeight: 700,
          }}
        >
          {t(DEFAULT_LOCALE, "app.name")}
        </div>

        <nav style={{ flex: 1 }}>
          <Link
            href="/portal"
            style={{
              display: "block",
              padding: "10px 18px",
              borderLeft: "2px solid var(--gold)",
              background: "var(--gold-light)",
              color: "var(--text-primary)",
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {t(DEFAULT_LOCALE, "nav.dashboard")}
          </Link>
        </nav>

        <div style={{ padding: "0 18px" }}>
          <LogoutButton />
        </div>
      </aside>

      <main style={{ flex: 1, padding: 32 }}>{children}</main>
    </div>
  );
}
