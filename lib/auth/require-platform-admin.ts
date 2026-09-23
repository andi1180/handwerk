import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/auth/platform-admin";

/**
 * Zugriffsschutz der Admin-Fläche `/admin/*` (Arbeitspaket A4a).
 *
 * Gegenstück zu `getCurrentBusiness()` für die Portal-Seiten, aber für die
 * GLOBALE Rolle `platform_admin` (Migration 0023) statt für eine
 * Betriebs-Mitgliedschaft:
 *  - kein User            ⇒ `redirect('/login')`
 *  - User, aber kein Admin ⇒ `notFound()` (404) — die Admin-Fläche soll für
 *    normale Nutzer nicht als existent erkennbar sein (kein 403, kein Hinweis)
 *  - Admin                ⇒ `{ userId }`
 *
 * Aufrufer: [app/admin/layout.tsx] (Oberfläche) UND jede Admin-Seite direkt
 * vor ihrem Datenzugriff. Warum beides: in Next.js wird ein Layout beim
 * Teil-Rendern (Navigation innerhalb eines Segments, gesteuert über den vom
 * Client mitgeschickten Router-Zustand) NICHT neu ausgeführt — ein Check nur im
 * Layout schützt die Daten der Seite also nicht zuverlässig. Die Seite prüft
 * deshalb selbst, unmittelbar vor der Query.
 *
 * `cache()` dedupliziert innerhalb EINES Requests: rendern Layout und Seite
 * gemeinsam, läuft der Auth-/Admin-Lookup nur einmal. Auch ein Wurf
 * (`redirect`/`notFound`) wird für den Rest des Requests zwischengespeichert —
 * beide Stellen sehen dasselbe Ergebnis.
 *
 * Die `userId` stammt ausschließlich aus der Session (`auth.getUser()`, gegen
 * den Auth-Server validiert — nicht `getSession()` aus dem Cookie). Ein
 * Datenbankfehler im Admin-Lookup wirft weiter (fail-safe = kein Zugriff bei
 * Unsicherheit, siehe `isPlatformAdmin`).
 */
export const requirePlatformAdmin = cache(
  async (): Promise<{ userId: string }> => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");

    if (!(await isPlatformAdmin(supabase, user.id))) notFound();

    return { userId: user.id };
  },
);
