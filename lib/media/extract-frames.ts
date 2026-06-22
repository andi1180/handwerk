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
export async function extractVideoFrames(
  file: File,
  diag?: (line: string) => void, // TEMP_FRAMEDIAG
): Promise<ExtractedFrame[]> {
  // TEMP_FRAMEDIAG
  diag?.(
    `start ${file.name} ${file.type || "?"} ${Math.round(file.size / 1024)}KB`,
  );
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("muted", "");

  try {
    video.src = objectUrl;
    await waitForMetadata(video, diag); // TEMP_FRAMEDIAG: diag durchgereicht
    // TEMP_FRAMEDIAG
    diag?.(
      `meta ok dur=${video.duration}s vw=${video.videoWidth} vh=${video.videoHeight} rs=${video.readyState}`,
    );

    const duration = video.duration;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!Number.isFinite(duration) || duration <= 0 || !vw || !vh) {
      diag?.(`abort: bad dims dur=${duration} vw=${vw} vh=${vh}`); // TEMP_FRAMEDIAG
      return [];
    }

    const { width, height } = scaledSize(vw, vh);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      diag?.(`abort: no canvas 2d ctx`); // TEMP_FRAMEDIAG
      return [];
    }

    const frames: ExtractedFrame[] = [];
    for (const [i, position] of VIDEO_FRAME_POSITIONS.entries()) {
      // 0 %/100 % meiden: knapp im Clip bleiben (sonst leeres letztes Frame).
      const time = clamp(
        duration * position,
        0.05,
        Math.max(0.05, duration - 0.1),
      );
      diag?.(`pos${i} seek=${time.toFixed(2)}s …`); // TEMP_FRAMEDIAG
      try {
        await seekTo(video, time);
        diag?.(`pos${i} seeked ok`); // TEMP_FRAMEDIAG
        ctx.drawImage(video, 0, 0, width, height);
        diag?.(`pos${i} draw w=${width} h=${height}`); // TEMP_FRAMEDIAG
        // TEMP_FRAMEDIAG: gemessenen Schwarz-Anteil mitgeben — Verwerf-Schwelle
        // (BLACK_RATIO) bleibt unverändert beim Aufrufer.
        const ratio = measureBlackRatio(ctx, width, height);
        const drop = ratio > BLACK_RATIO;
        diag?.(
          `pos${i} black=${ratio.toFixed(3)} verdict=${drop ? "drop" : "keep"}`,
        ); // TEMP_FRAMEDIAG
        if (drop) continue; // leeren Frame verwerfen
        const blob = await canvasToJpeg(canvas);
        diag?.(`pos${i} blob ${blob.size}B`); // TEMP_FRAMEDIAG
        frames.push({ index: i, blob });
      } catch (err) {
        // Einzelnen Frame überspringen; übrige weiter versuchen (graceful).
        diag?.(
          `pos${i} THROW ${err instanceof Error ? err.message : String(err)}`,
        ); // TEMP_FRAMEDIAG (z. B. seeked TIMEOUT / blob FAIL)
      }
    }
    diag?.(`frames=${frames.length}`); // TEMP_FRAMEDIAG
    return frames;
  } catch (err) {
    diag?.(`THROW ${err instanceof Error ? err.message : String(err)}`); // TEMP_FRAMEDIAG
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
function waitForMetadata(
  video: HTMLVideoElement,
  diag?: (line: string) => void, // TEMP_FRAMEDIAG
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (video.readyState >= 1 && Number.isFinite(video.duration)) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      diag?.(`meta TIMEOUT nach ${METADATA_TIMEOUT_MS}ms`); // TEMP_FRAMEDIAG
      reject(new Error("metadata_timeout"));
    }, METADATA_TIMEOUT_MS);
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      diag?.(`meta FAIL (error event)`); // TEMP_FRAMEDIAG
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
 * Schwarz-/Leer-Guard: misst über eine Pixel-Stichprobe den Anteil (nahezu)
 * schwarzer Pixel (0…1). Der Aufrufer verwirft den Frame bei `> BLACK_RATIO`.
 *
 * TEMP_FRAMEDIAG: aus dem früheren `isMostlyBlack` extrahiert, damit der gemessene
 * Anteil als Zahl ausgegeben werden kann — die Verwerf-Schwelle (BLACK_RATIO)
 * ist UNVERÄNDERT (das `> BLACK_RATIO` liegt jetzt beim Aufrufer). Leeres Canvas
 * (`pixels === 0`) liefert 1 ⇒ wird wie zuvor verworfen.
 */
function measureBlackRatio(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): number {
  const { data } = ctx.getImageData(0, 0, width, height);
  const pixels = width * height;
  if (pixels === 0) return 1;
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
  return total > 0 ? dark / total : 0;
}

/** Begrenzt `value` auf [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
