/**
 * Medien-Konstanten für Capture + Upload (Schritt 4b).
 *
 * Hinweis: Ein Video-Limit (Dauer/Größe) folgt in Schritt 4c. Die
 * Konfigurierbarkeit dieser Werte über die Betriebs-Einstellungen kommt später.
 */

/** Längste Kantenlänge (px), auf die Fotos vor dem Upload skaliert werden. */
export const MAX_IMAGE_DIM = 1500;

/** JPEG-Qualität beim Export der komprimierten Fotos (0…1). */
export const JPEG_QUALITY = 0.8;
