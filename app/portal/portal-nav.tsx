"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n";
import type { DictKey } from "@/lib/i18n/types";

/** Ein Nav-Eintrag: Ziel, i18n-Label-Schlüssel und Aktiv-Erkennung. */
type NavItem = {
  href: string;
  labelKey: DictKey<Dictionary>;
  isActive: (pathname: string) => boolean;
};

const ITEMS: NavItem[] = [
  {
    href: "/portal",
    labelKey: "nav.dashboard",
    isActive: (p) => p === "/portal",
  },
  {
    href: "/portal/orders",
    labelKey: "nav.orders",
    isActive: (p) => p.startsWith("/portal/orders"),
  },
];

/**
 * Sidebar-Navigation der Portal-Shell (Client Component, da Aktiv-Zustand vom
 * aktuellen Pfad abhängt). Aktiv = border-left 2px --gold + bg --gold-light.
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
