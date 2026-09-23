import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";

export const metadata: Metadata = {
  title: t(DEFAULT_LOCALE, "admin.metaTitle"),
};

/**
 * Schlanke Shell der Admin-Fläche (A4a). Bewusst eine EIGENE Top-Level-Route
 * und NICHT unter /portal: die Portal-Shell rendert Branding, Sidebar und
 * Bottom-Nav des Session-BETRIEBS — für eine betriebsübergreifende Sicht wäre
 * das falsch. Hier gibt es keinen Betrieb, nur die globale Rolle
 * `platform_admin`.
 *
 * `requirePlatformAdmin()` sperrt die Oberfläche (kein User ⇒ /login, kein
 * Admin ⇒ 404). Die Admin-SEITEN rufen denselben Helfer zusätzlich direkt vor
 * ihrem Datenzugriff auf — ein Layout wird beim Teil-Rendern nicht neu
 * ausgeführt und ist daher allein kein ausreichender Schutz für die Daten.
 * Dank `cache()` kostet das im Normalfall keinen zweiten Lookup.
 *
 * Desktop-only (Nutzung auf Andreas beschränkt); kein Logout-/Aktions-Button in
 * diesem Schritt — nur Anzeige.
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requirePlatformAdmin();

  return (
    <div className="admin-shell">
      <header className="admin-header">
        {/* eslint-disable-next-line @next/next/no-img-element -- statisches Branding-Asset, keine next/image-Optimierung nötig. */}
        <img
          className="admin-header-logo"
          src="/valooro.png"
          alt={t(DEFAULT_LOCALE, "app.name")}
        />
        <span className="admin-header-badge">
          {t(DEFAULT_LOCALE, "admin.badge")}
        </span>
      </header>
      <main className="admin-main">{children}</main>
    </div>
  );
}
