import { getCurrentBusiness } from "@/lib/auth/current-business";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/** Platzhalter-Dashboard der Portal-Shell (Schritt 2b). */
export default async function PortalDashboardPage() {
  const business = await getCurrentBusiness();
  if (!business) return null;

  const welcome = t(DEFAULT_LOCALE, "portal.welcome", { name: business.name });

  return (
    <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{welcome}</h1>
  );
}
