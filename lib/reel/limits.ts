/**
 * Größen-Absicherung des Betriebs-Reels (plain-TS, keine Server-Imports ⇒ per
 * `pnpm test` direkt prüfbar).
 *
 * Supabase Storage lehnt Dateien über dem projektweiten Limit von 50 MB ab
 * („The object exceeded the maximum allowed size"). Statt erst am Upload zu
 * scheitern, prüft `renderBusinessReel` die fertige Datei VOR dem Upload und
 * setzt den Status mit einer verständlichen Meldung auf 'failed'.
 *
 * ⚠️ Bewusst DEZIMAL (48 000 000 Bytes), nicht 48 × 1024²: 48 MiB wären
 * 50 331 648 Bytes und lägen über 50 MB, falls Supabase MB als 10⁶ zählt.
 * 48 000 000 liegt in beiden Lesarten unter dem Limit (2 MB Puffer).
 *
 * Messung + Worst-Case-Rechnung: TECH.md „Dateigröße Betriebs-Reel".
 */
export const BUSINESS_REEL_MAX_BYTES = 48_000_000;

/**
 * `true`, wenn das fertige Reel zu groß für den Upload ist. Unbekannte Größe
 * (`null`, z. B. stat fehlgeschlagen) ⇒ `false`: der Upload liest die Datei
 * ohnehin und scheitert dort mit eigenem Fehler.
 */
export function exceedsBusinessReelMaxBytes(bytes: number | null): boolean {
  return bytes !== null && bytes > BUSINESS_REEL_MAX_BYTES;
}
