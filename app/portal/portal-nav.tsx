"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n";
import type { DictKey } from "@/lib/i18n/types";

/** Ein Nav-Eintrag: Ziel, i18n-Label-Schlüssel, Aktiv-Erkennung und Tab-Icon. */
type NavItem = {
  href: string;
  labelKey: DictKey<Dictionary>;
  isActive: (pathname: string) => boolean;
  Icon: () => React.ReactElement;
};

/** Geteilte Quelle für Sidebar (Desktop) und Bottom-Tab-Nav (Mobile). */
const ITEMS: NavItem[] = [
  {
    href: "/portal",
    labelKey: "nav.dashboard",
    isActive: (p) => p === "/portal",
    Icon: DashboardIcon,
  },
  {
    href: "/portal/orders",
    labelKey: "nav.orders",
    isActive: (p) => p.startsWith("/portal/orders"),
    Icon: OrdersIcon,
  },
  {
    href: "/portal/settings",
    labelKey: "nav.settings",
    isActive: (p) => p.startsWith("/portal/settings"),
    Icon: SettingsIcon,
  },
];

/**
 * Sidebar-Navigation der Portal-Shell (Client Component, da Aktiv-Zustand vom
 * aktuellen Pfad abhängt). Aktiv = border-left 2px --gold + bg --gold-light.
 * Nur auf Desktop sichtbar (Sidebar ist auf Mobile ausgeblendet).
 */
export default function PortalNav() {
  const pathname = usePathname();

  return (
    <nav style={{ flex: 1 }}>
      {ITEMS.map((item) => {
        const active = item.isActive(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            style={{
              display: "block",
              padding: "10px 18px",
              borderLeft: `2px solid ${active ? "var(--gold)" : "transparent"}`,
              background: active ? "var(--gold-light)" : "transparent",
              color: "var(--text-primary)",
              fontSize: 14,
              fontWeight: active ? 600 : 500,
              textDecoration: "none",
            }}
          >
            {t(DEFAULT_LOCALE, item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * App-artige Bottom-Tab-Nav (Client Component) — nur auf Mobile sichtbar (per
 * CSS in [app/globals.css]). Aktiver Tab = --gold (Icon + Text), inaktiv
 * --text-secondary. Teilt sich die Item-Definition mit der Sidebar.
 */
export function PortalTabNav() {
  const pathname = usePathname();

  return (
    <nav className="portal-tabnav">
      {ITEMS.map((item) => {
        const active = item.isActive(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="portal-tab"
            data-active={active}
            aria-current={active ? "page" : undefined}
          >
            <item.Icon />
            {t(DEFAULT_LOCALE, item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}

/** Schlichtes Inline-SVG-Icon (Dashboard/Home). Reine Deko, erbt currentColor. */
function DashboardIcon() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 10.5 12 4l9 6.5" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M9.5 20v-5h5v5" />
    </svg>
  );
}

/** Schlichtes Inline-SVG-Icon (Aufträge/Liste). Reine Deko, erbt currentColor. */
function OrdersIcon() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </svg>
  );
}

/** Schlichtes Inline-SVG-Icon (Zahnrad/Einstellungen). Reine Deko. */
function SettingsIcon() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
