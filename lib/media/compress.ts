import { JPEG_QUALITY, MAX_IMAGE_DIM } from "./constants";

/** Ergebnis der Client-Kompression: JPEG-Blob plus dessen Pixelmaße. */
export type CompressedImage = {
  blob: Blob;
  width: number;
  height: number;
};

/**
 * Komprimiert ein Bild **im Browser**: dekodiert die Datei (EXIF-Orientierung
 * angewandt), skaliert die längste Kante auf {@link MAX_IMAGE_DIM} (Seiten-
 * verhältnis bleibt erhalten), zeichnet es auf ein Canvas und exportiert es als
 * JPEG ({@link JPEG_QUALITY}). Spart Upload-Volumen am Werkstück (Mobilfunk).
 */
export async function compressImage(file: File): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_context_unavailable");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await canvasToJpeg(canvas);
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
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
