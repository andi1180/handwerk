/**
 * Client-Aufbereitung der Intro-/Outro-Hintergrundbilder (Schritt 7c).
 *
 * Bewusst NICHT `prepareLogo` wiederverwendet: das Logo exportiert PNG (Alpha,
 * 512 px). Ein Hintergrund ist opak und full-bleed — JPEG (kleiner als PNG) bei
 * deutlich größerer Kante (1920 px) ist hier das richtige Ziel. Der Renderer
 * (Step 8) covert/croppt das Bild später auf 9:16 bzw. Portrait.
 */

/** Erlaubte Eingabe-MIME-Typen (Foto-Quellen). */
export const ACCEPTED_BACKGROUND_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/** `accept`-Attribut für das `<input type="file">` (eine Quelle, kein Drift). */
export const BACKGROUND_ACCEPT_ATTR = ACCEPTED_BACKGROUND_TYPES.join(",");

/** Maximale Eingabe-Dateigröße (10 MB) — vor jeglicher Verarbeitung geprüft. */
const MAX_BACKGROUND_BYTES = 10 * 1024 * 1024;

/** Längste Kante des aufbereiteten Hintergrunds (px). */
const MAX_BACKGROUND_DIM = 1920;

/** JPEG-Qualität des aufbereiteten Hintergrunds. */
const BACKGROUND_JPEG_QUALITY = 0.85;

/** Fehlerursache der Aufbereitung — die UI mappt sie auf i18n-Meldungen. */
export type BackgroundErrorCode = "type" | "tooLarge" | "decode";

/** Typisierter Aufbereitungsfehler (statt opaker Strings). */
export class BackgroundPrepareError extends Error {
  constructor(readonly code: BackgroundErrorCode) {
    super(code);
    this.name = "BackgroundPrepareError";
  }
}

/** Ergebnis der Aufbereitung: JPEG-Blob (opak, full-bleed). */
export type PreparedBackground = { blob: Blob };

/**
 * Bereitet ein Hintergrundbild **im Browser** auf: akzeptiert nur PNG/JPEG/WebP
 * (≤ 10 MB), skaliert seitenverhältnis-treu auf max. {@link MAX_BACKGROUND_DIM} px
 * (längste Kante) via Canvas und exportiert als **JPEG** ({@link BACKGROUND_JPEG_QUALITY}).
 * Wirft {@link BackgroundPrepareError}.
 */
export async function prepareBackground(file: File): Promise<PreparedBackground> {
  if (!(ACCEPTED_BACKGROUND_TYPES as readonly string[]).includes(file.type)) {
    throw new BackgroundPrepareError("type");
  }
  if (file.size > MAX_BACKGROUND_BYTES) {
    throw new BackgroundPrepareError("tooLarge");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new BackgroundPrepareError("decode");
  }
  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new BackgroundPrepareError("decode");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await canvasToJpeg(canvas);
    return { blob };
  } finally {
    bitmap.close();
  }
}

/** Skaliert (srcW × srcH) so, dass die längste Kante ≤ MAX_BACKGROUND_DIM ist. */
function scaledSize(
  srcW: number,
  srcH: number,
): { width: number; height: number } {
  const longest = Math.max(srcW, srcH);
  if (longest <= MAX_BACKGROUND_DIM) return { width: srcW, height: srcH };

  const scale = MAX_BACKGROUND_DIM / longest;
  return { width: Math.round(srcW * scale), height: Math.round(srcH * scale) };
}

/** Exportiert das Canvas als JPEG-Blob (promisifiziertes `toBlob`). */
function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new BackgroundPrepareError("decode"));
      },
      "image/jpeg",
      BACKGROUND_JPEG_QUALITY,
    );
  });
}
