import Anthropic from "@anthropic-ai/sdk";

/**
 * Server-seitiger Anthropic-Client (erste KI-Integration, Schritt 6b).
 *
 * SICHERHEIT: Der Key kommt ausschließlich aus `ANTHROPIC_API_KEY` (server-only,
 * NIE `NEXT_PUBLIC`, nie im Client). Dieses Modul darf nur aus Route Handlern /
 * Server-Code importiert werden.
 *
 * Modell-ID Haiku 4.5: `claude-haiku-4-5-20251001`. Liefert die API einen
 * Modell-ID-Fehler, hier auf die aktuelle Haiku-4.5-ID anpassen.
 */
export const HAIKU_MODEL = "claude-haiku-4-5-20251001";

/**
 * Modell-ID Sonnet 4.6: `claude-sonnet-4-6` (stärkeres Modell für das Booklet-
 * Intro, Schritt 8a-1). Liefert die API einen Modell-ID-Fehler, hier auf die
 * aktuelle Sonnet-4.6-ID anpassen (nicht raten — aus den Anthropic-Docs).
 */
export const SONNET_MODEL = "claude-sonnet-4-6";

let cached: Anthropic | null = null;

/**
 * Lazily instanziierter, prozessweit wiederverwendeter Client. Wirft, wenn der
 * Key fehlt — die aufrufende Route übersetzt das in eine klare Fehlermeldung
 * (kein stiller Leerlauf).
 */
export function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  if (!cached) {
    cached = new Anthropic({ apiKey });
  }
  return cached;
}

/** True, wenn die KI konfiguriert ist (Route-Guard vor Batch/Regenerate). */
export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
