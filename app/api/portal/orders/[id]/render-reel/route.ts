import { execFile } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { ensureFfmpeg, errMessage } from "@/lib/reel/ffmpeg";

/**
 * SCHRITT 8b-1a — Echtes Foto-Reel (FFmpeg-Assembly + async Job/Status).
 * Ersetzt die provisorische `render-reel-test`-Route.
 *
 * Baut aus den FOTOS eines generierten Booklets ein 9:16-Reel (1080x1920, je Foto
 * 3 s, HARTE Schnitte, KEIN Audio) und legt es im Storage ab. Der eigentliche
 * Render läuft in `after()` (Hintergrund nach der Response, innerhalb maxDuration);
 * der Fortschritt ist über `booklets.reel_status` persistent (Poll + Reload).
 *
 * KEIN Intro/Outro/Captions (8b-1b), KEINE Video-Clips (8b-2), KEIN Ken-Burns
 * (8b-3). NUR FFmpeg, KEIN Sharp.
 *
 * Node-Runtime erzwingen (Edge kann kein child_process / Binary ausführen) und
 * maxDuration anheben (Fluid Compute) — Download + ffmpeg + Upload dürfen dauern.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const execFileAsync = promisify(execFile);

/** ffmpeg darf nie hängen — nach diesem Timeout wird der Prozess gekillt. */
const FFMPEG_TIMEOUT_MS = 240_000;

/** Anzeigedauer je Foto im Reel (harte Schnitte, kein Übergang). */
const SECONDS_PER_PHOTO = 3;

/** 9:16-Hochformat (Instagram/TikTok-Reel). */
const REEL_W = 1080;
const REEL_H = 1920;
const REEL_FPS = 30;

type OrderRow = { id: string; business_id: string; status: string };
type BookletRow = { id: string };

/**
 * POST /api/portal/orders/[id]/render-reel
 *
 * Guards (alle vor dem Schreiben):
 *  - AUTHENTICATED Server-Client; kein User ⇒ 401, kein Betrieb ⇒ 403.
 *  - Order über RLS geladen (fremde/fehlende id ⇒ 404).
 *  - Status muss `generated` sein ⇒ sonst 409.
 *  - Mindestens ein FOTO (`order_media.media_type='photo'`) ⇒ sonst 400 need_photos
 *    (Clips kommen in 8b-2).
 *
 * ISOLATION (§14.2): Die `business_id` stammt AUS DER GELADENEN ORDER (über RLS
 * gegen die Session validiert), NIE aus dem Body. Alle Storage-/booklets-Writes
 * laufen über `service_role`, strikt auf diese `business_id` gescoped; der Pfad
 * `{business_id}/{order_id}/reel.mp4` deckt die bestehende 0002-Policy ab.
 *
 * Antwort: 202 (rendering gestartet). Die eigentliche Arbeit folgt in after().
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const business = await getCurrentBusiness();
  if (!business) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Order über RLS laden — fremde/fehlende id ⇒ 404. business_id ist hier
  // vertrauenswürdig (Session-Betrieb), Quelle für alle service_role-Writes.
  const { data: order } = await supabase
    .from("orders")
    .select("id, business_id, status")
    .eq("id", orderId)
    .maybeSingle<OrderRow>();
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Reel erst nach der Generierung — vorher gibt es kein Booklet/Intro.
  if (order.status !== "generated") {
    return NextResponse.json({ error: "invalid_status" }, { status: 409 });
  }

  // FOTOS in Reihenfolge laden (RLS). Ohne Foto kein Reel (Clips folgen 8b-2).
  const { data: photoRows } = await supabase
    .from("order_media")
    .select("storage_path")
    .eq("order_id", order.id)
    .eq("media_type", "photo")
    .order("sort_order", { ascending: true })
    .returns<{ storage_path: string }[]>();
  const photoPaths = (photoRows ?? []).map((r) => r.storage_path);
  if (photoPaths.length < 1) {
    return NextResponse.json({ error: "need_photos" }, { status: 400 });
  }

  // Booklet (existiert, da Status `generated`) über service_role laden — wir
  // setzen darauf den Render-Status. Strikt auf die Order-business_id gescoped.
  const service = createServiceClient();
  const { data: booklet, error: bookletError } = await service
    .from("booklets")
    .select("id")
    .eq("order_id", order.id)
    .eq("business_id", order.business_id)
    .maybeSingle<BookletRow>();
  if (bookletError || !booklet) {
    console.error("render-reel: booklet load failed", {
      order_id: order.id,
      step: "booklet_load",
      message: bookletError?.message ?? "no booklet",
    });
    return NextResponse.json({ error: "no_booklet" }, { status: 500 });
  }

  // Sofort auf 'rendering' setzen (reel_error löschen) und 202 zurückgeben.
  const { error: statusError } = await service
    .from("booklets")
    .update({ reel_status: "rendering", reel_error: null })
    .eq("id", booklet.id)
    .eq("business_id", order.business_id);
  if (statusError) {
    console.error("render-reel: set rendering failed", {
      order_id: order.id,
      step: "set_rendering",
      message: statusError.message,
    });
    return NextResponse.json({ error: "status_failed" }, { status: 500 });
  }

  // Heavy lifting NACH der Response (innerhalb maxDuration). Fehler landen in
  // reel_status='failed' + reel_error — der Client erfährt sie über den Poll.
  after(() =>
    renderReel({
      orderId: order.id,
      businessId: order.business_id,
      bookletId: booklet.id,
      photoPaths,
    }),
  );

  return NextResponse.json({ ok: true, status: "rendering" }, { status: 202 });
}

/**
 * Hintergrund-Render (after()): ffmpeg-Binary bereitstellen → Fotos nach /tmp
 * laden → 9:16-Reel bauen → nach `order-media` hochladen → booklet auf 'ready'
 * (mit reel_url = Storage-Pfad) bzw. bei jedem Fehler auf 'failed' (+ reel_error).
 * Alle Temp-Dateien werden aufgeräumt (NICHT /tmp/ffmpeg — das bleibt gecacht).
 */
async function renderReel({
  orderId,
  businessId,
  bookletId,
  photoPaths,
}: {
  orderId: string;
  businessId: string;
  bookletId: string;
  photoPaths: string[];
}): Promise<void> {
  const service = createServiceClient();
  const storagePath = `${businessId}/${orderId}/reel.mp4`;
  const tmpDir = tmpdir();
  const localPhotos: string[] = [];
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
    // 1) ffmpeg bereitstellen (Runtime-Download/Cache).
    let ffmpegBin: string;
    try {
      ffmpegBin = await ensureFfmpeg();
    } catch (error) {
      await fail("ensure_ffmpeg", error);
      return;
    }

    // 2) Fotos per service_role nach /tmp laden (Original-Extension behalten).
    try {
      for (const path of photoPaths) {
        const { data, error } = await service.storage
          .from("order-media")
          .download(path);
        if (error || !data) {
          throw new Error(`download ${path}: ${error?.message ?? "no data"}`);
        }
        const ext = extname(path) || ".jpg";
        const local = join(tmpDir, `photo-${randomUUID()}${ext}`);
        await writeFile(local, Buffer.from(await data.arrayBuffer()));
        localPhotos.push(local);
      }
    } catch (error) {
      await fail("download_photos", error);
      return;
    }

    // 3) FFmpeg: jedes Foto auf 1080x1920 covern (scale increase + crop), 3 s
    //    halten, HARTE Schnitte (concat-Filter), h264 + yuv420p + +faststart,
    //    KEIN Audio. Ein einziger Prozess, keine Zwischendateien.
    const inputArgs: string[] = [];
    const filterParts: string[] = [];
    localPhotos.forEach((local, i) => {
      inputArgs.push("-loop", "1", "-t", String(SECONDS_PER_PHOTO), "-i", local);
      // cover: hochskalieren bis beide Maße gefüllt sind, dann mittig zuschneiden.
      filterParts.push(
        `[${i}:v]scale=${REEL_W}:${REEL_H}:force_original_aspect_ratio=increase,` +
          `crop=${REEL_W}:${REEL_H},setsar=1,fps=${REEL_FPS}[v${i}]`,
      );
    });
    const concatInputs = localPhotos.map((_, i) => `[v${i}]`).join("");
    const filterComplex =
      `${filterParts.join(";")};${concatInputs}concat=n=${localPhotos.length}:v=1:a=0[outv]`;

    try {
      await execFileAsync(
        ffmpegBin,
        [
          "-y",
          "-nostdin",
          "-loglevel",
          "error",
          ...inputArgs,
          "-filter_complex",
          filterComplex,
          "-map",
          "[outv]",
          "-pix_fmt",
          "yuv420p",
          "-c:v",
          "libx264",
          "-movflags",
          "+faststart",
          "-an",
          outputPath,
        ],
        { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      );
    } catch (error) {
      await fail("ffmpeg", error);
      return;
    }

    // 4) Upload nach order-media (service_role, upsert überschreibt ein altes Reel).
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

    // 5) Erfolg: reel_url = Storage-Pfad (Signed-URL erst beim Poll/Render),
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
    const cleanup = [...localPhotos, outputPath];
    await Promise.all(
      cleanup.map((p) =>
        unlink(p).catch(() => {
          // ignorieren — Datei existiert evtl. nie (Fehler vor dem Schreiben).
        }),
      ),
    );
  }
}
