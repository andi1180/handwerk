import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import LogoutButton from "./logout-button";
import PortalNav, { PortalTabNav } from "./portal-nav";

/**
 * Geschützte Portal-Shell (Server Component, responsive — Schritt 4d).
 * Auth-Check (kein User → /login), Betriebs-Auflösung (kein Betrieb →
 * freundlicher Hinweis), sonst die Shell rendern: EINE App, deren Chrome per
 * Media Query umschaltet — Desktop (> 768px) zeigt die 220px-Sidebar, Mobile
 * (≤ 768px) eine schlanke Top-Bar + app-artige Bottom-Tab-Nav.
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
    <div className="portal-shell">
      {/* Desktop: Sidebar links (auf Mobile per CSS ausgeblendet). */}
      <aside className="portal-sidebar">
        {/* Valooro-Logo (getracktes App-Branding unter /public/valooro.png).
            Fehlt die Datei, bricht nur das Bild. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- statisches Branding-Asset, keine next/image-Optimierung nötig. */}
        <img
          className="portal-sidebar-logo"
          src="/valooro.png"
          alt={t(DEFAULT_LOCALE, "app.name")}
        />
        <hr className="portal-sidebar-divider" />
        <PortalNav />
        <div className="portal-sidebar-logout">
          <LogoutButton />
        </div>
      </aside>

      {/* Mobile: schlanke Top-Bar (auf Desktop per CSS ausgeblendet). */}
      <header className="portal-topbar">
        <span className="portal-topbar-brand">{business.name}</span>
        <LogoutButton compact />
      </header>

      <main className="portal-main">{children}</main>

      {/* Mobile: app-artige Bottom-Tab-Nav (auf Desktop per CSS ausgeblendet). */}
      <PortalTabNav />
    </div>
  );
}
