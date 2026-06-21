import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { displayCaption } from "@/lib/booklet/caption";
import type { MediaCategory } from "@/lib/orders/queries";
import { ensureFfmpeg, errMessage } from "@/lib/reel/ffmpeg";
import {
  assertReelAssets,
  bakeBusinessPhotoFrame,
  bakeIntroFrame,
  bakeOutroFrame,
  bakePhotoFrame,
  concatSegments,
  encodeStillSegment,
  normalizeClip,
} from "@/lib/reel/frames";

/**
 * Server-only Reel-Render (extrahiert aus der `render-reel`-Route, reiner Refactor —
 * KEIN Verhalten geändert), damit derselbe Render auch aus einem anderen Pfad
 * (z. B. `generate` → `after()`) aufrufbar ist.
 *
 * Baut aus einem generierten Booklet ein 9:16-Reel (1080x1920, HARTE Schnitte,
 * KEIN Audio): Intro-Frame → die MEDIEN in Booklet-Ordnung (Foto-Stills + Clips,
 * gemischt) → Outro-Frame. NUR FFmpeg, KEIN Sharp. Schrift + Scrims sind
 * MITGELIEFERT und EXPLIZIT per Pfad referenziert (kein fontconfig).
 */

/** Anzeigedauer je Foto im Reel (harte Schnitte, kein Übergang). */
const SECONDS_PER_PHOTO = 3;
/** Betriebs-Reel (0013, renderBusinessReel): etwas länger, damit Vorher/Nachher
 *  gut wahrnehmbar ist. */
const SECONDS_PER_PHOTO_BUSINESS = 4;
/** Clip-Cap (8b-2a): jeder Video-Clip wird auf min(Clip-Länge, 6 s) gekürzt — Tempo
 *  fürs Reel. In 8b-3 konfigurierbar. */
const MAX_CLIP_SECONDS = 6;
/** Intro länger (FIX 8b-1c): die persönliche Ich-Story (Titel + Beschreibung)
 *  muss lesbar sein. Outro bleibt knapp (nur Marke + ein paar Zeilen). */
const INTRO_SECONDS = 4;
const OUTRO_SECONDS = 2.5;

/** Ein Medien-Item (Foto ODER Video) — die Reel-Einheit (8b-2a), in Booklet-Ordnung. */
export type MediaItem = {
  storage_path: string;
  media_type: "photo" | "video";
  caption: string | null;
  keyword: string | null;
  category: MediaCategory;
};

/** Datei aus einem Bucket nach /tmp laden (oder null, wenn kein Pfad gesetzt). */
async function downloadAsset(
  service: ReturnType<typeof createServiceClient>,
  bucket: string,
  path: string | null,
  fallbackExt: string,
  collected: string[],
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await service.storage.from(bucket).download(path);
  if (error || !data) {
    throw new Error(`download ${path}: ${error?.message ?? "no data"}`);
  }
  const ext = extname(path) || fallbackExt;
  const local = join(tmpdir(), `asset-${randomUUID()}${ext}`);
  await writeFile(local, Buffer.from(await data.arrayBuffer()));
  collected.push(local);
  return local;
}

/**
 * Hintergrund-Render (after()): Assets prüfen → ffmpeg bereitstellen →
 * Branding-Assets (Logo/Intro-BG/Outro-BG) + ALLE Medien (Fotos + Clips) nach /tmp
 * laden → Intro-Segment, pro Item ein formatgleiches Segment (Foto-Still mit
 * Caption/Wasserzeichen bzw. normalisierter Clip) in sort_order und Outro-Segment
 * encoden → per concat-Demuxer (Intro → Items → Outro) zum 9:16-Reel fügen → nach
 * `order-media` hochladen → booklet auf 'ready' (reel_url) bzw. bei jedem Fehler auf
 * 'failed' (+ reel_error). Alle Temp-Dateien werden aufgeräumt (NICHT /tmp/ffmpeg —
 * das bleibt gecacht).
 */
export async function renderReel({
  orderId,
  businessId,
  bookletId,
  media,
  introTitle,
  introDescription,
  introTagline,
  businessName,
  outroMessage,
  contactLines,
  primaryColor,
  secondaryColor,
  logoPerPage,
  logoPath,
  introBgPath,
  outroBgPath,
}: {
  orderId: string;
  businessId: string;
  bookletId: string;
  media: MediaItem[];
  introTitle: string;
  introDescription: string | null;
  introTagline: string | null;
  businessName: string;
  outroMessage: string | null;
  contactLines: string[];
  primaryColor: string;
  secondaryColor: string;
  logoPerPage: boolean;
  logoPath: string | null;
  introBgPath: string | null;
  outroBgPath: string | null;
}): Promise<void> {
  const service = createServiceClient();
  const storagePath = `${businessId}/${orderId}/reel.mp4`;
  const tmpDir = tmpdir();
  const localMedia: string[] = []; // heruntergeladene Fotos + Clips (in sort_order)
  const pngFrames: string[] = []; // gebackene PNG-Frames (Intro/Foto/Outro)
  const segments: string[] = []; // normalisierte mp4-Segmente (Reihenfolge = Reel)
  const assets: string[] = []; // heruntergeladene Logo-/Hintergrund-Dateien
  const outputPath = join(tmpDir, `reel-${randomUUID()}.mp4`);

  /** Reel-Render bei einem Fehler als 'failed' markieren (mit Diagnose). */
  const fail = async (step: string, error: unknown): Promise<void> => {
    const message = errMessage(error);
    console.error("render-reel: failed", { order_id: orderId, step, message });
    await service
      .from("booklets")
      .update({ reel_status: "failed", reel_error: `${step}: ${message}` })
      .eq("id", bookletId)
      .eq("business_id", businessId);
  };

  try {
    // 0) Mitgelieferte Assets (Schrift + Scrims) müssen lesbar sein — ein
    //    fehlgeschlagenes Tracing wird hier als klares `assets_missing` sichtbar.
    try {
      await assertReelAssets();
    } catch (error) {
      await fail("assets_missing", error);
      return;
    }

    // 1) ffmpeg bereitstellen (Runtime-Download/Cache, drawtext-geprüft).
    let ffmpegBin: string;
    try {
      ffmpegBin = await ensureFfmpeg();
    } catch (error) {
      await fail("ensure_ffmpeg", error);
      return;
    }

    // 2) Branding-Assets aus dem privaten `branding`-Bucket laden (falls gesetzt).
    //    Das Logo wird im Intro/Outro UND (bei logo_per_page) als Wasserzeichen
    //    genutzt — einmal laden, mehrfach verwenden.
    let logoLocal: string | null;
    let introBgLocal: string | null;
    let outroBgLocal: string | null;
    try {
      logoLocal = await downloadAsset(service, "branding", logoPath, ".png", assets);
      introBgLocal = await downloadAsset(service, "branding", introBgPath, ".jpg", assets);
      outroBgLocal = await downloadAsset(service, "branding", outroBgPath, ".jpg", assets);
    } catch (error) {
      await fail("download_assets", error);
      return;
    }

    // 3) ALLE Medien (Fotos + Clips) per service_role nach /tmp laden (Original-
    //    Extension behalten — ffmpeg demuxt nach ihr). Reihenfolge bleibt sort_order
    //    (= localMedia-Index, parallel zu `media`).
    try {
      for (const item of media) {
        const { data, error } = await service.storage
          .from("order-media")
          .download(item.storage_path);
        if (error || !data) {
          throw new Error(
            `download ${item.storage_path}: ${error?.message ?? "no data"}`,
          );
        }
        const ext =
          extname(item.storage_path) || (item.media_type === "video" ? ".mp4" : ".jpg");
        const local = join(tmpDir, `media-${randomUUID()}${ext}`);
        await writeFile(local, Buffer.from(await data.arrayBuffer()));
        localMedia.push(local);
      }
    } catch (error) {
      await fail("download_media", error);
      return;
    }

    // 4) Intro-Frame backen (PNG) + zum ERSTEN Segment encoden.
    try {
      const introFrame = join(tmpDir, `intro-${randomUUID()}.png`);
      pngFrames.push(introFrame);
      await bakeIntroFrame({
        ffmpegBin,
        output: introFrame,
        title: introTitle,
        description: introDescription,
        tagline: introTagline,
        bgPath: introBgLocal,
        logoPath: logoLocal,
        primaryColor,
        secondaryColor,
      });
      const introSeg = join(tmpDir, `seg-${randomUUID()}.mp4`);
      await encodeStillSegment({
        ffmpegBin,
        image: introFrame,
        seconds: INTRO_SECONDS,
        output: introSeg,
      });
      segments.push(introSeg);
    } catch (error) {
      await fail("bake_intro", error);
      return;
    }

    // 5) Pro Item EIN formatgleiches Segment, in sort_order (interleaved):
    //    Foto → Frame backen (cover + Caption + optionales Wasserzeichen) → Still-
    //    Segment (3 s); Video → Clip normalisieren (cover, 30 fps, yuv420p, stumm,
    //    6 s-Cap) MIT derselben Caption/Wasserzeichen-Overlay-Kette wie das Foto
    //    (8b-2b, über den Video-Stream, statisch über die volle Clip-Dauer).
    try {
      for (let i = 0; i < media.length; i++) {
        const item = media[i]!;
        const local = localMedia[i]!;
        const segment = join(tmpDir, `seg-${randomUUID()}.mp4`);
        try {
          if (item.media_type === "video") {
            await normalizeClip({
              ffmpegBin,
              input: local,
              maxSeconds: MAX_CLIP_SECONDS,
              output: segment,
              // DIESELBE Overlay-Behandlung wie das Foto (8b-2b): Caption
              // (caption ?? keyword) + optionales Wasserzeichen (logo_per_page).
              caption: displayCaption(item),
              logoPath: logoPerPage ? logoLocal : null,
              primaryColor,
            });
          } else {
            const framePath = join(tmpDir, `frame-${randomUUID()}.png`);
            pngFrames.push(framePath);
            await bakePhotoFrame({
              ffmpegBin,
              input: local,
              output: framePath,
              caption: displayCaption(item),
              logoPath: logoPerPage ? logoLocal : null,
              primaryColor,
            });
            await encodeStillSegment({
              ffmpegBin,
              image: framePath,
              seconds: SECONDS_PER_PHOTO,
              output: segment,
            });
          }
        } catch (error) {
          // Item-Kontext anhängen (welches Medium scheiterte) für die Diagnose.
          throw new Error(`item ${i} (${item.media_type}): ${errMessage(error)}`);
        }
        segments.push(segment);
      }
    } catch (error) {
      await fail("build_segments", error);
      return;
    }

    // 6) Outro-Frame backen (PNG) + zum LETZTEN Segment encoden.
    try {
      const outroFrame = join(tmpDir, `outro-${randomUUID()}.png`);
      pngFrames.push(outroFrame);
      await bakeOutroFrame({
        ffmpegBin,
        output: outroFrame,
        businessName,
        message: outroMessage,
        contactLines,
        bgPath: outroBgLocal,
        logoPath: logoLocal,
        primaryColor,
        secondaryColor,
      });
      const outroSeg = join(tmpDir, `seg-${randomUUID()}.mp4`);
      await encodeStillSegment({
        ffmpegBin,
        image: outroFrame,
        seconds: OUTRO_SECONDS,
        output: outroSeg,
      });
      segments.push(outroSeg);
    } catch (error) {
      await fail("bake_outro", error);
      return;
    }

    // 7) Segmente per concat-Demuxer (-c copy) fügen: Intro → Items (sort_order) →
    //    Outro, harte Schnitte. Bricht, wenn Segmente formatungleich sind —
    //    encodeStillSegment/normalizeClip garantieren EINE kanonische Form.
    try {
      await concatSegments({ ffmpegBin, segments, output: outputPath });
    } catch (error) {
      await fail("concat", error);
      return;
    }

    // 8) Upload nach order-media (service_role, upsert überschreibt ein altes Reel).
    try {
      const fileBuffer = await readFile(outputPath);
      const { error: uploadError } = await service.storage
        .from("order-media")
        .upload(storagePath, fileBuffer, {
          contentType: "video/mp4",
          upsert: true,
        });
      if (uploadError) throw new Error(uploadError.message);
    } catch (error) {
      await fail("upload", error);
      return;
    }

    // 9) Erfolg: reel_url = Storage-Pfad (Signed-URL erst beim Poll/Render),
    //    reel_status = 'ready', reel_error löschen.
    const { error: doneError } = await service
      .from("booklets")
      .update({ reel_url: storagePath, reel_status: "ready", reel_error: null })
      .eq("id", bookletId)
      .eq("business_id", businessId);
    if (doneError) {
      await fail("mark_ready", doneError);
      return;
    }
  } finally {
    // Temp-Dateien aufräumen (NICHT /tmp/ffmpeg — bleibt für warme Instanzen).
    const cleanup = [...localMedia, ...pngFrames, ...segments, ...assets, outputPath];
    await Promise.all(
      cleanup.map((p) =>
        unlink(p).catch(() => {
          // ignorieren — Datei existiert evtl. nie (Fehler vor dem Schreiben).
        }),
      ),
    );
  }
}

/**
 * Betriebs-Reel (0013, Schritt 2b): Kein Intro/Outro — nur die Medien in
 * Booklet-Reihenfolge (before → process → after), je 4 s Stills.
 *
 *  - before/after-Fotos: bakeBusinessPhotoFrame → großes, oben ZENTRIERTES
 *                        VORHER/NACHHER-Label, KEIN Logo.
 *  - process-Fotos:      bakeBusinessPhotoFrame → kein Label, Logo rechts oben.
 *  - Clips (Prozess):    normalizeClip mit logoPosition:'topright', Logo rechts
 *                        oben (stumm, ≤6 s).
 *
 * Das Logo wird immer geladen (nicht per logo_per_page gated), aber nur auf
 * Prozess-Inhalt (process-Fotos + Clips) overlayt — auf before/after trägt das
 * Label allein die obere Zone.
 *
 * Status-Writes gegen `booklets.business_reel_status/url/error` (0013).
 * service_role für alle Storage- und booklets-Zugriffe.
 */
export async function renderBusinessReel({
  orderId,
  businessId,
  bookletId,
  media,
  primaryColor,
  logoPath,
}: {
  orderId: string;
  businessId: string;
  bookletId: string;
  media: MediaItem[];
  primaryColor: string;
  logoPath: string | null;
}): Promise<void> {
  const service = createServiceClient();
  const storagePath = `${businessId}/${orderId}/business-reel.mp4`;
  const tmpDir = tmpdir();
  const localMedia: string[] = [];
  const pngFrames: string[] = [];
  const segments: string[] = [];
  const assets: string[] = [];
  const outputPath = join(tmpDir, `business-reel-${randomUUID()}.mp4`);

  const fail = async (step: string, error: unknown): Promise<void> => {
    const message = errMessage(error);
    console.error("render-business-reel: failed", {
      order_id: orderId,
      step,
      message,
    });
    await service
      .from("booklets")
      .update({
        business_reel_status: "failed",
        business_reel_error: `${step}: ${message}`,
      })
      .eq("id", bookletId)
      .eq("business_id", businessId);
  };

  try {
    // 0) Mitgelieferte Assets prüfen.
    try {
      await assertReelAssets();
    } catch (error) {
      await fail("assets_missing", error);
      return;
    }

    // 1) ffmpeg bereitstellen.
    let ffmpegBin: string;
    try {
      ffmpegBin = await ensureFfmpeg();
    } catch (error) {
      await fail("ensure_ffmpeg", error);
      return;
    }

    // 2) Logo aus dem privaten `branding`-Bucket laden (immer, nicht per
    //    logo_per_page gated — das Betriebs-Reel trägt immer das Logo).
    let logoLocal: string | null = null;
    if (logoPath) {
      try {
        logoLocal = await downloadAsset(service, "branding", logoPath, ".png", assets);
      } catch (error) {
        await fail("download_assets", error);
        return;
      }
    }

    // 3) Alle Medien nach /tmp laden.
    try {
      for (const item of media) {
        const { data, error } = await service.storage
          .from("order-media")
          .download(item.storage_path);
        if (error || !data) {
          throw new Error(
            `download ${item.storage_path}: ${error?.message ?? "no data"}`,
          );
        }
        const ext =
          extname(item.storage_path) || (item.media_type === "video" ? ".mp4" : ".jpg");
        const local = join(tmpDir, `biz-media-${randomUUID()}${ext}`);
        await writeFile(local, Buffer.from(await data.arrayBuffer()));
        localMedia.push(local);
      }
    } catch (error) {
      await fail("download_media", error);
      return;
    }

    // 4) Pro Item EIN formatgleiches Segment in Booklet-Reihenfolge (before →
    //    process → after). before/after-Fotos: zentriertes VORHER/NACHHER-Label,
    //    KEIN Logo. process-Fotos + Clips: Logo rechts oben (logoPosition:'topright').
    try {
      for (let i = 0; i < media.length; i++) {
        const item = media[i]!;
        const local = localMedia[i]!;
        const segment = join(tmpDir, `biz-seg-${randomUUID()}.mp4`);
        try {
          if (item.media_type === "video") {
            await normalizeClip({
              ffmpegBin,
              input: local,
              maxSeconds: MAX_CLIP_SECONDS,
              output: segment,
              caption: displayCaption(item),
              logoPath: logoLocal,
              primaryColor,
              logoPosition: "topright",
            });
          } else {
            const framePath = join(tmpDir, `biz-frame-${randomUUID()}.png`);
            pngFrames.push(framePath);
            const label =
              item.category === "before"
                ? "VORHER"
                : item.category === "after"
                  ? "NACHHER"
                  : undefined;
            // Logo NUR auf Prozess-Fotos (kein Label) — before/after tragen das
            // große, zentrierte VORHER/NACHHER-Label und KEIN Logo.
            const logoForFrame = label !== undefined ? null : logoLocal;
            await bakeBusinessPhotoFrame({
              ffmpegBin,
              input: local,
              output: framePath,
              caption: displayCaption(item),
              logoPath: logoForFrame,
              primaryColor,
              label,
            });
            await encodeStillSegment({
              ffmpegBin,
              image: framePath,
              seconds: SECONDS_PER_PHOTO_BUSINESS,
              output: segment,
            });
          }
        } catch (error) {
          throw new Error(`item ${i} (${item.media_type}/${item.category}): ${errMessage(error)}`);
        }
        segments.push(segment);
      }
    } catch (error) {
      await fail("build_segments", error);
      return;
    }

    // 5) Segmente per concat-Demuxer fügen (Items in Booklet-Reihenfolge, kein
    //    Intro/Outro im Betriebs-Reel).
    try {
      await concatSegments({ ffmpegBin, segments, output: outputPath });
    } catch (error) {
      await fail("concat", error);
      return;
    }

    // 6) Upload nach order-media (service_role, upsert).
    try {
      const fileBuffer = await readFile(outputPath);
      const { error: uploadError } = await service.storage
        .from("order-media")
        .upload(storagePath, fileBuffer, {
          contentType: "video/mp4",
          upsert: true,
        });
      if (uploadError) throw new Error(uploadError.message);
    } catch (error) {
      await fail("upload", error);
      return;
    }

    // 7) Erfolg.
    const { error: doneError } = await service
      .from("booklets")
      .update({
        business_reel_url: storagePath,
        business_reel_status: "ready",
        business_reel_error: null,
      })
      .eq("id", bookletId)
      .eq("business_id", businessId);
    if (doneError) {
      await fail("mark_ready", doneError);
    }
  } finally {
    const cleanup = [...localMedia, ...pngFrames, ...segments, ...assets, outputPath];
    await Promise.all(
      cleanup.map((p) =>
        unlink(p).catch(() => {
          /* ignorieren */
        }),
      ),
    );
  }
}
