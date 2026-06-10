"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/**
 * Meldet den Nutzer ab und leitet zurück zum Login.
 * `compact` = kompakter Icon-Button für die mobile Top-Bar; sonst der
 * vollbreite Text-Button der Desktop-Sidebar.
 */
export default function LogoutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    if (loading) return;
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  const label = t(DEFAULT_LOCALE, "nav.logout");

  if (compact) {
    return (
      <button
        type="button"
        className="btn-outline"
        aria-label={label}
        title={label}
        style={{
          flexShrink: 0,
          padding: 8,
          border: "none",
          opacity: loading ? 0.7 : 1,
        }}
        disabled={loading}
        onClick={() => void handleLogout()}
      >
        <LogoutIcon />
      </button>
    );
  }

  return (
    <button
      type="button"
      className="btn-outline"
      style={{ width: "100%", opacity: loading ? 0.7 : 1 }}
      disabled={loading}
      onClick={() => void handleLogout()}
    >
      {label}
    </button>
  );
}

/** Schlichtes Inline-SVG-Icon (Abmelden/Exit). Reine Deko, erbt currentColor. */
function LogoutIcon() {
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
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 17l-5-5 5-5" />
      <path d="M5 12h12" />
    </svg>
  );
}
