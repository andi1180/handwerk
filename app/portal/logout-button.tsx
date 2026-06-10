"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/** Meldet den Nutzer ab und leitet zurück zum Login. */
export default function LogoutButton() {
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

  return (
    <button
      type="button"
      className="btn-outline"
      style={{ width: "100%", opacity: loading ? 0.7 : 1 }}
      disabled={loading}
      onClick={() => void handleLogout()}
    >
      {t(DEFAULT_LOCALE, "nav.logout")}
    </button>
  );
}
