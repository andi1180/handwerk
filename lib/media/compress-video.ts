import { execFile } from "node:child_process";
import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureFfmpeg, errMessage } from "@/lib/reel/ffmpeg";

/**
 * Server-seitige Video-Kompression eines einzelnen `order_media`-Videos —
 * **server-only**, geteilt zwischen dem Route-Handler
 * (`POST …/media/[mediaId]/compress`, direkt nach dem Upload) und einem späteren
 * **gezielten Nachlauf** für bestehende Aufträge. Die Route enthält bewusst
 * KEINE eigene Transkodier-Logik — dasselbe Muster wie
 * [purgeOrderMedia](lib/media/purge-order-media.ts), damit beide Aufrufer
 * garantiert identisch arbeiten.
 *
 * ZWECK: Speicherplatz sparen. Handy-Videos kommen mit hoher Bitrate (1080p+,
 * oft 5–10 MB/s) — für die Booklet-/Reel-Nutzung reicht ein 720p-H.264-Transkode
 * bei Weitem. Das Original wird **unverändert hochgeladen und ist sofort
 * verfügbar**; die Kompression läuft asynchron danach (fire-and-forget).
 *
 * ZEITKONTEXT: Booklets werden erst Tage nach der Auftragsfertigstellung
 * versendet — es gibt bewusst KEINEN synchronen Wartemechanismus und keinen
 * Status-Poll. Schlägt die Kompression fehl, bleibt schlicht das Original liegen
 * (voll funktionsfähig, nur größer) und ein späterer gezielter Nachlauf kann es
 * erneut versuchen.
 *
 * ERSETZEN AM SELBEN PFAD: die komprimierte Datei überschreibt das Original
 * unter demselben `storage_path` (`upsert`) — dadurch bleiben ALLE bestehenden
 * Referenzen gültig: die `order_media`-Zeile, die Konventions-Pfade der
 * Vorschau-Frames (`{pfad}.frame-{i}.jpg`) und jede bereits erzeugte Signed-URL.
 * Es wird NICHTS umbenannt und KEINE DB-Spalte geschrieben.
 *
 * KEIN drawtext / KEIN Overlay: dieser Pfad ist eine **reine Transkodierung**
 * (scale + libx264 + aac). Die bekannte FFmpeg-6.0.1-Falle (zentrierende
 * `(…)/2`-Ausdrücke in `drawtext`/`drawbox` rendern auf dem Production-Build
 * still nichts) ist hier also nicht anwendbar — es gibt keinen einzigen
 * Text-/Overlay-Filter in diesem Filtergraph.
 *
 * ISOLATION (§14.2): `businessId` kommt vom Aufrufer (Route: aus der über RLS
 * geladenen Order = Session-Betrieb) und wird JEDER Query als Filter mitgegeben;
 * der Storage-Pfad wird zusätzlich gegen das `{business_id}/{order_id}/`-Präfix
 * geprüft. Es wird nie eine business_id aus dem Request-Body oder aus den Daten
 * abgeleitet.
 *
 * Fehlerverhalten: die Funktion **wirft nicht**, sondern meldet `ok: false` plus
 * `errors`. Das Original bleibt bei JEDEM Fehler unangetastet (die Datei wird
 * erst am Ende und nur bei Erfolg überschrieben) ⇒ kein Datenverlust. Ein
 * erneuter Aufruf ist gefahrlos.
 */

/** Bucket, in dem alle Auftragsmedien liegen. */
const BUCKET = "order-media";

/**
 * Ziel-Auflösung: die **kurze Seite** auf 720 cappen — orientierungsUNabhängig.
 * Die jeweils andere Seite folgt proportional und wird über `-2` auf eine GERADE
 * Zahl gerundet (libx264/yuv420p braucht gerade Kantenlängen).
 *
 * Querformat (`iw > ih`) ⇒ Breite `-2`, Höhe 720 ⇒ 1920×1080 wird 1280×720.
 * Hochformat ⇒ umgekehrt: Breite 720, Höhe `-2` ⇒ 1080×1920 wird 720×1280.
 *
 * FIX gegenüber dem pauschalen `scale=-2:720`: das cappte immer die HÖHE und
 * machte aus einem Hochkant-Handyvideo (dem Normalfall) 406×720 — im 9:16-Reel
 * (1080×1920) hätte das um Faktor ~2,7 hochskaliert werden müssen. Jetzt liefert
 * Hochformat 720×1280 (nur noch 1,5×); Querformat bleibt unverändert.
 *
 * Zur ffmpeg-6.0.1-Verträglichkeit: `-2` ist in `scale` IMMER ein Ausdrucks-
 * Ergebnis (auch das literale `scale=-2:720` wird als Expression ausgewertet) —
 * ob der Wert aus `if(gt(…))` kommt, ändert am Filter-Code nichts. Es ist auch
 * nie beides negativ (die Zweige sind komplementär), der „both dimensions
 * negative"-Fehler kann also nicht auftreten. `if`/`gt` gehören zum Standard-
 * Funktionsumfang des eval-Parsers.
 */
const SCALE_FILTER =
  "scale='if(gt(iw,ih),-2,720)':'if(gt(iw,ih),720,-2)'";

/** H.264-Qualität (CRF 23 = visuell nahezu verlustfrei bei ~1/4 der Größe). */
const CRF = "23";
const PRESET = "medium";

/** Audio: AAC 128 kb/s. Hat der Clip keine Tonspur, wählt ffmpeg schlicht keine
 *  aus und die Optionen laufen ins Leere — verhält sich dann wie `-an`. */
const AUDIO_BITRATE = "128k";

/** ffmpeg darf nie hängen. Großzügig, aber innerhalb der Route-`maxDuration`. */
const FFMPEG_TIMEOUT_MS = 240_000;
const FFMPEG_MAX_BUFFER = 4 * 1024 * 1024;

/**
 * Ersetzt wird nur, wenn das Ergebnis SPÜRBAR kleiner ist (< 90 % des Originals).
 * Das schützt gleich mehrere Grenzfälle mit einer einzigen Regel: bereits kleine
 * bzw. schon komprimierte Videos (ein zweiter Lauf würde nur eine weitere
 * Encoder-Generation kosten) und niedrig aufgelöste Quellen, die der 720er-Cap
 * hochskalieren würde.
 */
const REPLACE_MAX_RATIO = 0.9;

const execFileAsync = promisify(execFile);

/** Die für die Kompression benötigten Felder der Medien-Zeile. */
type VideoRow = {
  id: string;
  media_type: string;
  storage_path: string;
};

export type CompressOrderVideoResult = {
  /** true, wenn kein Schritt einen Fehler gemeldet hat. */
  ok: boolean;
  mediaId: string;
  storagePath: string | null;
  /** true ⇒ bewusst NICHT ersetzt (siehe `reason`), kein Fehler. */
  skipped: boolean;
  /** Grund fürs Überspringen (`not_smaller`) — sonst null. */
  reason: string | null;
  originalBytes: number;
  compressedBytes: number;
  /** Ersparnis in MB (2 Nachkommastellen), 0 wenn nicht ersetzt. */
  megabytesSaved: number;
  /** Nicht-leer ⇒ mindestens ein Schritt ist gescheitert. */
  errors: string[];
};

export async function compressOrderVideo(
  client: SupabaseClient,
  {
    orderId,
    businessId,
    mediaId,
  }: { orderId: string; businessId: string; mediaId: string },
): Promise<CompressOrderVideoResult> {
  const errors: string[] = [];
  const result: CompressOrderVideoResult = {
    ok: true,
    mediaId,
    storagePath: null,
    skipped: false,
    reason: null,
    originalBytes: 0,
    compressedBytes: 0,
    megabytesSaved: 0,
    errors,
  };

  const done = (): CompressOrderVideoResult => {
    result.ok = errors.length === 0;
    return result;
  };

  // ── 1) Medien-Zeile laden (RLS + defensive Filter auf Order UND Betrieb) ──
  const { data: media, error: loadError } = await client
    .from("order_media")
    .select("id, media_type, storage_path")
    .eq("id", mediaId)
    .eq("order_id", orderId)
    .eq("business_id", businessId)
    .maybeSingle<VideoRow>();
  if (loadError) {
    errors.push(`load_media: ${loadError.message}`);
    return done();
  }
  if (!media) {
    errors.push("load_media: not found");
    return done();
  }
  if (media.media_type !== "video") {
    errors.push(`load_media: not a video (${media.media_type})`);
    return done();
  }

  // Der Pfad MUSS im mandanten- und auftragsskopierten Präfix liegen — zusätzlich
  // zur Storage-RLS, die das erste Segment ohnehin an die business_id bindet.
  const requiredPrefix = `${businessId}/${orderId}/`;
  if (!media.storage_path.startsWith(requiredPrefix)) {
    errors.push(
      `invalid_path: "${media.storage_path}" outside "${requiredPrefix}"`,
    );
    return done();
  }
  result.storagePath = media.storage_path;

  const tmpDir = tmpdir();
  const inputPath = join(
    tmpDir,
    `src-${randomUUID()}${extname(media.storage_path) || ".mp4"}`,
  );
  const outputPath = join(tmpDir, `compressed-${randomUUID()}.mp4`);

  try {
    // ── 2) ffmpeg bereitstellen (Runtime-Download nach /tmp, warm gecacht) ──
    let ffmpegBin: string;
    try {
      ffmpegBin = await ensureFfmpeg();
    } catch (error) {
      errors.push(`ensure_ffmpeg: ${errMessage(error)}`);
      return done();
    }

    // ── 3) Original nach /tmp laden ────────────────────────────────────────
    try {
      const { data, error } = await client.storage
        .from(BUCKET)
        .download(media.storage_path);
      if (error || !data) throw new Error(error?.message ?? "no data");
      const buffer = Buffer.from(await data.arrayBuffer());
      await writeFile(inputPath, buffer);
      result.originalBytes = buffer.byteLength;
    } catch (error) {
      errors.push(`download: ${errMessage(error)}`);
      return done();
    }

    // ── 4) Transkodieren: 720p / H.264 CRF 23 / AAC 128k ───────────────────
    // Reine Transkodierung, KEIN drawtext/overlay (s. Modul-Doku). `autorotate`
    // greift vor den Filtern ⇒ Hochkant-Handyclips werden korrekt aufgerichtet.
    try {
      await execFileAsync(
        ffmpegBin,
        [
          "-y",
          "-nostdin",
          "-loglevel",
          "error",
          "-i",
          inputPath,
          "-vf",
          SCALE_FILTER,
          "-c:v",
          "libx264",
          "-crf",
          CRF,
          "-preset",
          PRESET,
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          AUDIO_BITRATE,
          "-movflags",
          "+faststart",
          outputPath,
        ],
        { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: FFMPEG_MAX_BUFFER },
      );
      const { size } = await stat(outputPath);
      result.compressedBytes = size;
    } catch (error) {
      errors.push(`ffmpeg: ${errMessage(error)}`);
      return done();
    }

    // ── 5) Nur ersetzen, wenn spürbar kleiner ──────────────────────────────
    if (
      result.compressedBytes <= 0 ||
      result.compressedBytes > result.originalBytes * REPLACE_MAX_RATIO
    ) {
      result.skipped = true;
      result.reason = "not_smaller";
      return done();
    }

    // ── 6) Original am SELBEN Pfad überschreiben (alle Referenzen bleiben) ──
    // Erst hier wird etwas verändert: bis zu diesem Punkt ist jeder Fehlerpfad
    // ohne Nebenwirkung auf das Original.
    try {
      const fileBuffer = await readFile(outputPath);
      const { error: uploadError } = await client.storage
        .from(BUCKET)
        .upload(media.storage_path, fileBuffer, {
          contentType: "video/mp4",
          upsert: true,
        });
      if (uploadError) throw new Error(uploadError.message);
    } catch (error) {
      errors.push(`upload: ${errMessage(error)}`);
      return done();
    }

    result.megabytesSaved = Number(
      ((result.originalBytes - result.compressedBytes) / 1024 / 1024).toFixed(2),
    );
    return done();
  } finally {
    // Temp-Dateien aufräumen (NICHT /tmp/ffmpeg — das bleibt gecacht).
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}
