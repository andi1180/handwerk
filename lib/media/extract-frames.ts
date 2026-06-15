import { scaledSize, canvasToJpeg } from "./compress";
import { VIDEO_FRAME_POSITIONS } from "./video-frames";

/**
 * Client-seitige **Video-Frame-Extraktion** (Phase 1).
 *
 * Zieht aus einer Video-Datei bis zu 3 Standbilder (~10 % / ~50 % / ~90 % der
 * Dauer — nicht 0 %/100 %, die sind oft schwarz/unvollständig). Pro Position:
 * `<video>` an die Zeit seeken → `seeked` abwarten → auf ein Canvas zeichnen →
 * JPEG-Blob (wie die Foto-Kompression: längste Kante ≤ MAX_IMAGE_DIM,
 * JPEG_QUALITY). Nahezu schwarze/leere Frames werden **verworfen**.
 *
 * Bewusst best-effort + **graceful**: jeder Fehler (Seek-Timeout, Decode-Problem,
 * nur schwarze Frames) führt zu *weniger oder keinen* Frames — niemals zu einem
 * Throw nach außen. Der Aufrufer lädt das Video unabhängig davon normal hoch.
 *
 * iOS-Safari-Härtung: gemuteter, inline `<video>` (kein Autoplay-Block),
 * `preload="auto"`, nach jedem `seeked` zwei rAF-Ticks Wartezeit (damit der
 * Frame tatsächlich gepaint ist, bevor `drawImage` greift), Timeout pro Seek.
 */

/** Ein extrahierter Frame: Positions-Index (0…N) + JPEG-Blob. */
export type ExtractedFrame = { index: number; blob: Blob };

/** Maximale Wartezeit auf Metadaten bzw. einen einzelnen Seek (ms). */
const METADATA_TIMEOUT_MS = 8000;
const SEEK_TIMEOUT_MS = 5000;

/** Luma-Schwelle, unter der ein Pixel als „schwarz" gilt (0…255). */
const BLACK_LUMA = 16;
/** Anteil schwarzer Pixel, ab dem ein Frame als leer/schwarz verworfen wird. */
const BLACK_RATIO = 0.98;
/** Ungefähre Anzahl Pixel-Stichproben für den Schwarz-Check. */
const SAMPLE_TARGET = 4096;

/**
 * Extrahiert die Vorschau-Frames. Liefert die gültigen (nicht-schwarzen) Frames
 * mit ihrem Positions-Index; bei Problemen ein leeres bzw. kürzeres Array.
 */
export async function extractVideoFrames(file: File): Promise<ExtractedFrame[]> {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("muted", "");

  try {
    video.src = objectUrl;
    await waitForMetadata(video);

    const duration = video.duration;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!Number.isFinite(duration) || duration <= 0 || !vw || !vh) return [];

    const { width, height } = scaledSize(vw, vh);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];

    const frames: ExtractedFrame[] = [];
    for (const [i, position] of VIDEO_FRAME_POSITIONS.entries()) {
      // 0 %/100 % meiden: knapp im Clip bleiben (sonst leeres letztes Frame).
      const time = clamp(
        duration * position,
        0.05,
        Math.max(0.05, duration - 0.1),
      );
      try {
        await seekTo(video, time);
        ctx.drawImage(video, 0, 0, width, height);
        if (isMostlyBlack(ctx, width, height)) continue; // leeren Frame verwerfen
        const blob = await canvasToJpeg(canvas);
        frames.push({ index: i, blob });
      } catch {
        // Einzelnen Frame überspringen; übrige weiter versuchen (graceful).
      }
    }
    return frames;
  } catch {
    return []; // Metadaten-/Decode-Problem ⇒ keine Frames, Video lädt trotzdem hoch.
  } finally {
    URL.revokeObjectURL(objectUrl);
    video.removeAttribute("src");
    try {
      video.load();
    } catch {
      // egal — reine Aufräum-Geste.
    }
  }
}

/** Wartet auf `loadedmetadata` (mit Timeout). */
function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (video.readyState >= 1 && Number.isFinite(video.duration)) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("metadata_timeout"));
    }, METADATA_TIMEOUT_MS);
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("metadata_failed"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("error", onError);
  });
}

/**
 * Seekt das Video an `time` und wartet auf `seeked`. Nach dem Event zwei
 * rAF-Ticks, damit iOS den Frame wirklich gepaint hat, bevor gezeichnet wird.
 * Timeout-geschützt, damit ein hängender Seek die Extraktion nicht blockiert.
 */
function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("seek_timeout"));
    }, SEEK_TIMEOUT_MS);
    const onSeeked = () => {
      cleanup();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    };
    const onError = () => {
      cleanup();
      reject(new Error("seek_failed"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = time;
  });
}

/**
 * Schwarz-/Leer-Guard: zählt über eine Pixel-Stichprobe den Anteil (nahezu)
 * schwarzer Pixel. > BLACK_RATIO ⇒ Frame gilt als leer und wird verworfen.
 */
function isMostlyBlack(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): boolean {
  const { data } = ctx.getImageData(0, 0, width, height);
  const pixels = width * height;
  if (pixels === 0) return true;
  const step = Math.max(1, Math.floor(pixels / SAMPLE_TARGET));
  let dark = 0;
  let total = 0;
  for (let p = 0; p < pixels; p += step) {
    const i = p * 4;
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luma < BLACK_LUMA) dark++;
    total++;
  }
  return total > 0 && dark / total > BLACK_RATIO;
}

/** Begrenzt `value` auf [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
