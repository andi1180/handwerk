/**
 * Baut den IG-Caption-Vorschlag (Schritt 9b) — reines TEMPLATE, KEIN KI-Call.
 *
 * Der Kunde kopiert ihn, um ihn beim Instagram-Post (zum geteilten Reel)
 * einzufügen; der vorangestellte @-Handle des Betriebs ist der Tagging-
 * Multiplikator (§9). Zusammengesetzt aus dem Intro-Titel + (falls gesetzt)
 * @ig_handle + einem kleinen kuratierten Hashtag-Set.
 *
 * Reine Funktion ohne Secrets/SDK — kann NICHT fehlschlagen (anders als der
 * Sonnet-Review). MVP: deutsche Hashtags (sprach-parametrisierbar später, §15).
 */
const IG_HASHTAGS = [
  "#handwerk",
  "#handmade",
  "#vorhernachher",
  "#handwerkskunst",
  "#ausliebezumhandwerk",
] as const;

export function buildIgCaption(input: {
  introTitle: string;
  igHandle: string | null;
}): string {
  const lines: string[] = [];

  const title = input.introTitle.trim();
  if (title) lines.push(title);

  const handle = normalizeHandle(input.igHandle);
  if (handle) lines.push(`Gemacht von @${handle}`);

  lines.push(IG_HASHTAGS.join(" "));
  return lines.join("\n\n");
}

/** „@name" / „ @name " / „name" → „name" (führende @ + Whitespace entfernt). */
function normalizeHandle(raw: string | null): string | null {
  if (!raw) return null;
  const handle = raw.trim().replace(/^@+/, "").trim();
  return handle.length > 0 ? handle : null;
}
