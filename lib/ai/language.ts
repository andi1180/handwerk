/**
 * Sprach-Anzeigenamen für KI-Prompts. EINE Quelle für Intro (Schritt 8a-1) und
 * Review (Schritt 9b) — §15: neue Sprache = ein Eintrag hier, kein Refactor.
 */
const LANGUAGE_NAMES: Record<string, string> = { de: "Deutsch" };

/** Anzeigename einer Sprache für den Prompt (Fallback: der Code selbst). */
export function languageName(language: string): string {
  return LANGUAGE_NAMES[language] ?? language;
}
