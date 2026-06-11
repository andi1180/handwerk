import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import LogoutButton from "@/app/portal/logout-button";

/**
 * Warteseite für noch nicht freigeschaltete Betriebe (Self-Service-Registrierung,
 * Option C). Liegt bewusst NICHT unter /portal — der Portal-Layout würde sonst
 * `getCurrentBusiness` aufrufen, das pending-Betriebe genau hierher redirectet
 * (Endlosschleife). Diese Seite ruft `getCurrentBusiness` daher NICHT auf; sie
 * prüft nur, dass überhaupt ein User eingeloggt ist.
 */
export default async function PendingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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
      <div className="card" style={{ width: "100%", maxWidth: 420, textAlign: "center" }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 700 }}>
          {t(DEFAULT_LOCALE, "pending.title")}
        </h1>
        <hr className="divider-gold" />
        <p style={{ margin: "0 0 20px", fontSize: 15, lineHeight: 1.55 }}>
          {t(DEFAULT_LOCALE, "pending.message")}
        </p>
        <LogoutButton />
      </div>
    </main>
  );
}
