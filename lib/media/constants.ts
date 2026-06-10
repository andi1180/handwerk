/**
 * Medien-Konstanten für Capture + Upload (Schritte 4b/4c).
 *
 * Hinweis: Die Konfigurierbarkeit dieser Werte über die Betriebs-Einstellungen
 * kommt später.
 */

/** Längste Kantenlänge (px), auf die Fotos vor dem Upload skaliert werden. */
export const MAX_IMAGE_DIM = 1500;

/** JPEG-Qualität beim Export der komprimierten Fotos (0…1). */
export const JPEG_QUALITY = 0.8;

/** Maximale erlaubte Video-Länge (Sekunden). Später via Settings konfigurierbar. */
export const MAX_VIDEO_SECONDS = 30;
