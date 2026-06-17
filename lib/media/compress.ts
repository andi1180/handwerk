import { JPEG_QUALITY, MAX_IMAGE_DIM } from "./constants";

/** Ergebnis der Client-Kompression: JPEG-Blob plus dessen Pixelmaße. */
export type CompressedImage = {
  blob: Blob;
  width: number;
  height: number;
};

/**
 * Das Bild konnte mit KEINEM Browser-Pfad dekodiert werden (typischerweise HEIC/
 * HEIF auf älterem iOS < 17). Eigener Typ, damit die UI eine ehrliche, konkrete
 * Hilfe anzeigen kann statt eines generischen „Upload fehlgeschlagen".
 */
export class UnsupportedImageError extends Error {
  constructor(message = "unsupported_image") {
    super(message);
    this.name = "UnsupportedImageError";
  }
}

/**
 * Komprimiert ein Bild **im Browser**: dekodiert die Datei (EXIF-Orientierung
 * angewandt), skaliert die längste Kante auf {@link MAX_IMAGE_DIM} (Seiten-
 * verhältnis bleibt erhalten), zeichnet es auf ein Canvas und exportiert es als
 * JPEG ({@link JPEG_QUALITY}). Spart Upload-Volumen am Werkstück (Mobilfunk).
 *
 * Zwei Dekodier-Pfade: primär `createImageBitmap` (schnell, wendet die EXIF-
 * Orientierung an). Manche iOS-Versionen können **HEIC/HEIF** (Kameraroll-Standard)
 * darüber NICHT dekodieren und werfen sofort — dann greift der `<img>`-Fallback,
 * den iOS Safari für HEIC **nativ** unterstützt (derselbe Decoder wie die
 * Vorschau). Scheitern beide ⇒ {@link UnsupportedImageError}.
 */
export async function compressImage(file: File): Promise<CompressedImage> {
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    try {
      return await drawScaledToJpeg(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  } catch {
    // createImageBitmap kann HEIC/HEIF auf manchen iOS-Versionen nicht — Fallback.
  }

  try {
    return await compressViaImageElement(file);
  } catch (err) {
    // Beide Pfade gescheitert: bei HEIC/HEIF ist das der „nicht dekodierbar"-Fall
    // (älteres iOS) ⇒ typisierter Fehler für eine konkrete UI-Hilfe.
    if (isHeic(file)) throw new UnsupportedImageError();
    throw err;
  }
}

/** Erkennt HEIC/HEIF an MIME-Typ oder Dateiendung (iOS-Kameraroll-Format). */
function isHeic(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type === "image/heic" || type === "image/heif") return true;
  return /\.(heic|heif)$/i.test(file.name);
}

/**
 * Fallback-Dekodierung über ein `<img>`-Element (objectURL). iOS Safari nutzt
 * hier den vollen System-Decoder und kann HEIC zuverlässig dekodieren — die
 * Browser-Orientierung wird beim `drawImage` mit übernommen.
 */
function compressViaImageElement(file: File): Promise<CompressedImage> {
  return new Promise<CompressedImage>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      drawScaledToJpeg(img, img.naturalWidth, img.naturalHeight)
        .then(resolve, reject)
        .finally(() => URL.revokeObjectURL(url));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image_decode_failed"));
    };
    img.src = url;
  });
}

/**
 * Zeichnet eine dekodierte Bildquelle (ImageBitmap oder `<img>`) skaliert auf ein
 * Canvas und exportiert sie als JPEG. Gemeinsamer Schritt beider Dekodier-Pfade.
 */
async function drawScaledToJpeg(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
): Promise<CompressedImage> {
  const { width, height } = scaledSize(srcW, srcH);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_context_unavailable");
  ctx.drawImage(source, 0, 0, width, height);

  const blob = await canvasToJpeg(canvas);
  return { blob, width, height };
}

/** Skaliert (srcW × srcH) so, dass die längste Kante ≤ MAX_IMAGE_DIM ist. */
export function scaledSize(
  srcW: number,
  srcH: number,
): { width: number; height: number } {
  const longest = Math.max(srcW, srcH);
  if (longest <= MAX_IMAGE_DIM) return { width: srcW, height: srcH };

  const scale = MAX_IMAGE_DIM / longest;
  return { width: Math.round(srcW * scale), height: Math.round(srcH * scale) };
}

/** Exportiert das Canvas als JPEG-Blob (promisifiziertes `toBlob`). */
export function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("canvas_export_failed"));
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}
