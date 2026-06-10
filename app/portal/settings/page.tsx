import { notFound } from "next/navigation";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm } from "./settings-form";

/**
 * Einstellungs-Seite (Server Component, desktop-first Management, responsiv
 * nutzbar). Lädt den Betrieb über `getCurrentBusiness` (Session, RLS-erzwungen)
 * und rendert die Client-Form mit den aktuellen Werten. Die Portal-Shell
 * garantiert bereits einen Betrieb; der Guard ist defensiv (Typsicherheit).
 */
export default async function SettingsPage() {
  const business = await getCurrentBusiness();
  if (!business) notFound();

  // Privater Bucket → Logo-Vorschau über eine server-seitig signierte URL (1 h).
  let logoPreviewUrl: string | null = null;
  if (business.branding.logo_url) {
    const supabase = await createClient();
    const { data } = await supabase.storage
      .from("branding")
      .createSignedUrl(business.branding.logo_url, 3600);
    logoPreviewUrl = data?.signedUrl ?? null;
  }

  return <SettingsForm business={business} logoPreviewUrl={logoPreviewUrl} />;
}
