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

  // Privater Bucket `branding` → Vorschauen über server-seitig signierte URLs
  // (1 h). Logo (7a) + Intro-/Outro-Hintergrund (7c) teilen sich denselben
  // Signier-Helfer; ohne gesetzten Pfad bleibt die jeweilige Vorschau null.
  const supabase = await createClient();
  const sign = async (path: string | null): Promise<string | null> => {
    if (!path) return null;
    const { data } = await supabase.storage
      .from("branding")
      .createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  };

  const [logoPreviewUrl, introBgPreviewUrl, outroBgPreviewUrl] =
    await Promise.all([
      sign(business.branding.logo_url),
      sign(business.branding.intro_bg_url),
      sign(business.branding.outro_bg_url),
    ]);

  return (
    <SettingsForm
      business={business}
      logoPreviewUrl={logoPreviewUrl}
      introBgPreviewUrl={introBgPreviewUrl}
      outroBgPreviewUrl={outroBgPreviewUrl}
    />
  );
}
