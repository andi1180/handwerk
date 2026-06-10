import { notFound } from "next/navigation";
import { getCurrentBusiness } from "@/lib/auth/current-business";
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

  return <SettingsForm business={business} />;
}
