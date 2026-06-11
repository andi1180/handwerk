// Nur server-seitig. NIEMALS in Client Components importieren.
// NIEMALS mit NEXT_PUBLIC_ prefixen.
import { Resend } from "resend";

/**
 * Server-seitiger Resend-Client (Schritt 9c-1, transaktionale E-Mail).
 *
 * SICHERHEIT: Der Key kommt ausschließlich aus `RESEND_API_KEY` (server-only,
 * NIE `NEXT_PUBLIC`, nie im Client). Dieses Modul darf nur aus Route Handlern /
 * Server-Code importiert werden. Muster wie `lib/ai/anthropic.ts`.
 */
let cached: Resend | null = null;

/**
 * Lazily instanziierter, prozessweit wiederverwendeter Client. Wirft, wenn der
 * Key fehlt — der aufrufende Code fängt das (E-Mail nicht-blockierend, 9c-1).
 */
export function getResend(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set");
  }
  if (!cached) {
    cached = new Resend(apiKey);
  }
  return cached;
}

/** True, wenn der E-Mail-Versand konfiguriert ist. */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}
