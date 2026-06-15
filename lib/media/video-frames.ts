/**
 * Konventionen für **extrahierte Video-Vorschau-Frames** (Phase 1).
 *
 * Aus einem hochgeladenen Video werden client-seitig 3 Standbilder gezogen
 * (~10 % / ~50 % / ~90 % der Dauer) und unter einem **Konventions-Pfad** abgelegt,
 * der direkt vom Storage-Pfad des Videos abgeleitet ist:
 *
 *   {video-pfad-ohne-endung}.frame-{index}.jpg
 *
 * Die Frames liegen damit unter demselben `{business_id}/{order_id}/`-Präfix wie
 * das Video — die Storage-RLS aus Migration 0002 (erstes Pfad-Segment =
 * business_id) greift unverändert. **Keine DB-Zeile**, **keine Migration**: die
 * Existenz eines Frames wird allein über den Storage-Pfad bestimmt.
 *
 * Dieses Modul enthält **nur reine Funktionen/Konstanten** (kein DOM, kein
 * Server-Import) und ist daher sowohl client- (Capture-Upload) als auch
 * server-seitig (Detailseite signiert die Frames) importierbar. Die eigentliche
 * DOM-Extraktion liegt in `extract-frames.ts` (nur Client).
 */

/** Relative Positionen (Anteil der Dauer), an denen Frames gezogen werden. */
export const VIDEO_FRAME_POSITIONS = [0.1, 0.5, 0.9] as const;

/** Anzahl der Frame-Slots pro Video (= Länge von VIDEO_FRAME_POSITIONS). */
export const VIDEO_FRAME_COUNT = VIDEO_FRAME_POSITIONS.length;

/** Entfernt die letzte Dateiendung (`.mov`, `.mp4`, …) aus einem Storage-Pfad. */
function stripExtension(path: string): string {
  return path.replace(/\.[^/.]+$/, "");
}

/**
 * Konventions-Pfad eines extrahierten Frames für ein Video. Leitet sich direkt
 * vom Video-Storage-Pfad ab und behält dessen `{business_id}/{order_id}/`-Präfix.
 */
export function videoFramePath(videoStoragePath: string, index: number): string {
  return `${stripExtension(videoStoragePath)}.frame-${index}.jpg`;
}

/** Alle Kandidaten-Pfade (frame-0…frame-N) für ein Video, der Reihe nach. */
export function videoFramePaths(videoStoragePath: string): string[] {
  return Array.from({ length: VIDEO_FRAME_COUNT }, (_, i) =>
    videoFramePath(videoStoragePath, i),
  );
}
