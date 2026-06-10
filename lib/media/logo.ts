/**
 * Client-Aufbereitung des Betriebs-Logos (Schritt 7a).
 *
 * Bewusst NICHT `compressImage` wiederverwendet: jenes exportiert JPEG und
 * verliert damit den Alpha-Kanal. Logos brauchen Transparenz → Export als PNG.
 */

/** Erlaubte Eingabe-MIME-Typen (Alpha-fähig bzw. verlustfrei skalierbar). */
export const ACCEPTED_LOGO_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/** `accept`-Attribut für das `<input type="file">` (eine Quelle, kein Drift). */
export const LOGO_ACCEPT_ATTR = ACCEPTED_LOGO_TYPES.join(",");

/** Maximale Eingabe-Dateigröße (5 MB) — vor jeglicher Verarbeitung geprüft. */
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/** Längste Kante des aufbereiteten Logos (px). */
const MAX_LOGO_DIM = 512;

/** Fehlerursache der Aufbereitung — die UI mappt sie auf i18n-Meldungen. */
export type LogoErrorCode = "type" | "tooLarge" | "decode";

/** Typisierter Aufbereitungsfehler (statt opaker Strings). */
export class LogoPrepareError extends Error {
  constructor(readonly code: LogoErrorCode) {
    super(code);
    this.name = "LogoPrepareError";
  }
}

/** Ergebnis der Aufbereitung: PNG-Blob (Alpha bleibt erhalten). */
export type PreparedLogo = { blob: Blob };

/**
 * Bereitet ein Logo **im Browser** auf: akzeptiert nur PNG/JPEG/WebP (≤ 5 MB),
 * skaliert seitenverhältnis-treu auf max. {@link MAX_LOGO_DIM} px (längste Kante)
 * und exportiert als **PNG** — anders als {@link compressImage} (JPEG) bleibt damit
 * ein transparenter Hintergrund (Alpha) erhalten. Wirft {@link LogoPrepareError}.
 */
export async function prepareLogo(file: File): Promise<PreparedLogo> {
  if (!(ACCEPTED_LOGO_TYPES as readonly string[]).includes(file.type)) {
    throw new LogoPrepareError("type");
  }
  if (file.size > MAX_LOGO_BYTES) {
    throw new LogoPrepareError("tooLarge");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new LogoPrepareError("decode");
  }
  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new LogoPrepareError("decode");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await canvasToPng(canvas);
    return { blob };
  } finally {
    bitmap.close();
  }
}

/** Skaliert (srcW × srcH) so, dass die längste Kante ≤ MAX_LOGO_DIM ist. */
function scaledSize(
  srcW: number,
  srcH: number,
): { width: number; height: number } {
  const longest = Math.max(srcW, srcH);
  if (longest <= MAX_LOGO_DIM) return { width: srcW, height: srcH };

  const scale = MAX_LOGO_DIM / longest;
  return { width: Math.round(srcW * scale), height: Math.round(srcH * scale) };
}

/** Exportiert das Canvas als PNG-Blob (promisifiziertes `toBlob`, Alpha erhalten). */
function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new LogoPrepareError("decode"));
    }, "image/png");
  });
}
