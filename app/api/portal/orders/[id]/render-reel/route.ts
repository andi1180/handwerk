import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { DEFAULT_BRANDING, isHexColor } from "@/lib/settings/options";
import { displayCaption } from "@/lib/booklet/caption";
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
 * NEU in 8b-1b: pro Foto wird (falls vorhanden) die Caption unten in der
 * Safe-Zone ins Bild gebrannt — mute-safe, der Text trägt die Story. Der Text
 * kommt aus `displayCaption` (caption ?? keyword; beide leer ⇒ sauberes Foto,
 * kein Scrim) — dieselbe Quelle wie die Web-Story (kein Drift). Gerendert mit
 * ffmpeg `drawtext` und einer **mitgelieferten** Schrift (assets/fonts/…ttf,
 * explizit per `fontfile=` referenziert — NIE über fontconfig, das auf Vercel
 * leer ist) + statischem Gradient-Scrim (assets/reel/caption-scrim.png).
 *
 * KEIN Intro/Outro (8b-1c), KEINE Video-Clips (8b-2), KEIN Ken-Burns (8b-3).
 * NUR FFmpeg, KEIN Sharp. Per-Betrieb-Schrift im Reel ist eine spätere Politur.
 *
 * Node-Runtime erzwingen (Edge kann kein child_process / Binary ausführen) und
 * maxDuration anheben (Fluid Compute) — Download + ffmpeg + Upload dürfen dauern.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const execFileAsync = promisify(execFile);

/** ffmpeg darf nie hängen — nach diesem Timeout wird der Prozess gekillt. */
const FFMPEG_TIMEOUT_MS = 240_000;
/** Eigenes (kürzeres) Timeout für das Backen eines einzelnen Foto-Frames. */
const FRAME_TIMEOUT_MS = 60_000;

/** Anzeigedauer je Foto im Reel (harte Schnitte, kein Übergang). */
const SECONDS_PER_PHOTO = 3;

/** 9:16-Hochformat (Instagram/TikTok-Reel). */
const REEL_W = 1080;
const REEL_H = 1920;
const REEL_FPS = 30;

/**
 * Caption-Overlay-Layout im 1080x1920-Frame (8b-1b). Spiegelt die Web-Story
 * (booklet.css `.booklet-caption`): unteres Drittel, ~16 % über dem Rand
 * (Safe-Zone über der IG/TikTok-UI). Links-bündig statt zentriert — robust
 * ohne `text_align` (erst ab neueren ffmpeg-Builds), für mehrzeilige Captions
 * vorhersehbar.
 */
const SIDE_MARGIN = 80; // linker Textrand
const BOTTOM_MARGIN = 307; // ~16 % von 1920 (Safe-Zone)
const CAPTION_GAP = 28; // Abstand Textunterkante ↔ Branding-Akzentbalken
const CAPTION_FONT_SIZE = 52;
const CAPTION_LINE_SPACING = 12;
const CAPTION_MAX_CHARS = 28; // konservativer Zeilenumbruch (Glyphenbreite ungemessen)
const ACCENT_W = 72; // Branding-Akzentbalken (primary_color), links unter der Caption
const ACCENT_H = 5;

/**
 * MITGELIEFERTE Assets, EXPLIZIT referenziert (kein System-/fontconfig-Lookup —
 * der ist auf Vercel leer). Beide werden via `outputFileTracingIncludes`
 * (next.config.ts) in die render-reel-Function getraced; zur Laufzeit liegen sie
 * relativ zu `process.cwd()` (= Function-Root auf Vercel). Klein (Font ~130 KB,
 * Scrim ~10 KB) — kein Größenproblem wie beim ffmpeg-Binary (8b-0).
 */
const FONT_PATH = join(process.cwd(), "assets/fonts/PlusJakartaSans-SemiBold.ttf");
const SCRIM_PATH = join(process.cwd(), "assets/reel/caption-scrim.png");

type OrderRow = { id: string; business_id: string; status: string };
type BookletRow = { id: string };
type PhotoItem = {
  storage_path: string;
  caption: string | null;
  keyword: string | null;
};

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

  // FOTOS in Reihenfolge laden (RLS), inkl. caption/keyword für die Overlays
  // (8b-1b). Ohne Foto kein Reel (Clips folgen 8b-2).
  const { data: photoRows } = await supabase
    .from("order_media")
    .select("storage_path, caption, keyword")
    .eq("order_id", order.id)
    .eq("media_type", "photo")
    .order("sort_order", { ascending: true })
    .returns<PhotoItem[]>();
  const photos = photoRows ?? [];
  if (photos.length < 1) {
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
      photos,
      // Branding-Akzentfarbe (already normalisiertes Hex) für den Caption-Balken.
      primaryColor: business.branding.primary_color,
    }),
  );

  return NextResponse.json({ ok: true, status: "rendering" }, { status: 202 });
}

/**
 * Greedy-Wortumbruch für die Caption. drawtext bricht NICHT automatisch um — wir
 * fügen echte Zeilenumbrüche ein und schreiben den Text in eine `textfile` (so
 * entfällt jegliches Escapen von `:`/`%`/Umlauten im Filtergraph). Konservatives
 * Zeichen-Limit pro Zeile (Glyphenbreite ungemessen) → kann nie über den Rand
 * laufen; ein einzelnes überlanges Wort bekommt notfalls eine eigene Zeile.
 */
function wrapCaption(text: string, maxChars: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line === "") {
      line = word;
    } else if (line.length + 1 + word.length <= maxChars) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

/** `#RRGGBB` → ffmpeg-Farbe `0xRRGGBB` (defensiv auf das Default-Branding fallen). */
function brandColorArg(hex: string): string {
  const valid = isHexColor(hex) ? hex : DEFAULT_BRANDING.primary_color;
  return `0x${valid.slice(1)}`;
}

/**
 * Hintergrund-Render (after()): ffmpeg bereitstellen → Fotos nach /tmp laden →
 * pro Foto einen 1080x1920-Frame backen (cover-crop, + Caption-Overlay falls
 * vorhanden) → die Frames zum 9:16-Reel zusammenfügen → nach `order-media`
 * hochladen → booklet auf 'ready' (mit reel_url = Storage-Pfad) bzw. bei jedem
 * Fehler auf 'failed' (+ reel_error). Alle Temp-Dateien werden aufgeräumt
 * (NICHT /tmp/ffmpeg — das bleibt gecacht).
 *
 * Zweistufig (statt eines einzigen großen Filtergraphen): jedes Foto wird in
 * einem eigenen, simplen ffmpeg-Aufruf gebacken (drawtext isoliert → klarer
 * Fehler, falls die Schrift im Serverless nicht gefunden/gerendert wird), dann
 * ein zweiter Aufruf für die Foto-Sequenz (3 s/Foto, harte Schnitte).
 */
async function renderReel({
  orderId,
  businessId,
  bookletId,
  photos,
  primaryColor,
}: {
  orderId: string;
  businessId: string;
  bookletId: string;
  photos: PhotoItem[];
  primaryColor: string;
}): Promise<void> {
  const service = createServiceClient();
  const storagePath = `${businessId}/${orderId}/reel.mp4`;
  const tmpDir = tmpdir();
  const localPhotos: string[] = [];
  const frames: string[] = [];
  const captionFiles: string[] = [];
  const outputPath = join(tmpDir, `reel-${randomUUID()}.mp4`);

  // Caption pro Foto vorab auflösen (caption ?? keyword; beide leer ⇒ null =
  // sauberes Foto ohne Scrim). Gleiche Quelle wie die Web-Story (kein Drift).
  const captions = photos.map((p) => displayCaption(p));
  const hasCaptions = captions.some((c) => c !== null);
  const accentColor = brandColorArg(primaryColor);

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

    // 1b) Schrift muss vorhanden sein, sobald wir Captions brennen — ein
    //     fehlgeschlagenes Tracing (outputFileTracingIncludes) wird hier als
    //     klares `font_missing` sichtbar, NICHT als kryptischer ffmpeg-Fehler.
    if (hasCaptions) {
      try {
        await access(FONT_PATH, fsConstants.R_OK);
      } catch (error) {
        await fail("font_missing", error);
        return;
      }
    }

    // 2) Fotos per service_role nach /tmp laden (Original-Extension behalten).
    try {
      for (const photo of photos) {
        const { data, error } = await service.storage
          .from("order-media")
          .download(photo.storage_path);
        if (error || !data) {
          throw new Error(
            `download ${photo.storage_path}: ${error?.message ?? "no data"}`,
          );
        }
        const ext = extname(photo.storage_path) || ".jpg";
        const local = join(tmpDir, `photo-${randomUUID()}${ext}`);
        await writeFile(local, Buffer.from(await data.arrayBuffer()));
        localPhotos.push(local);
      }
    } catch (error) {
      await fail("download_photos", error);
      return;
    }

    // 3) Pro Foto einen 1080x1920-PNG-Frame backen: cover (scale increase +
    //    crop), und — falls Caption — Scrim überlagern, Branding-Akzentbalken
    //    zeichnen und die (umgebrochene) Caption links-bündig in der Safe-Zone
    //    ins Bild brennen. Fotos OHNE Caption bleiben sauber (kein Scrim).
    try {
      for (let i = 0; i < localPhotos.length; i++) {
        const input = localPhotos[i]!;
        const caption = captions[i] ?? null;
        const framePath = join(tmpDir, `frame-${randomUUID()}.png`);

        if (caption === null) {
          // Sauberes Foto: nur cover-crop.
          await execFileAsync(
            ffmpegBin,
            [
              "-y",
              "-nostdin",
              "-loglevel",
              "error",
              "-i",
              input,
              "-vf",
              `scale=${REEL_W}:${REEL_H}:force_original_aspect_ratio=increase,` +
                `crop=${REEL_W}:${REEL_H},setsar=1`,
              "-frames:v",
              "1",
              framePath,
            ],
            { timeout: FRAME_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
          );
        } else {
          // Umgebrochene Caption in eine textfile schreiben (kein Filtergraph-
          // Escaping nötig — auch Umlaute/Sonderzeichen sind unkritisch).
          const capFile = join(tmpDir, `cap-${randomUUID()}.txt`);
          await writeFile(capFile, wrapCaption(caption, CAPTION_MAX_CHARS), "utf8");
          captionFiles.push(capFile);

          // [base] cover-crop → [scr] Scrim drüber → [bar] Akzentbalken (primary)
          //  → drawtext: weißer SemiBold-Text, links-bündig, unten verankert
          //  (text_h wächst nach oben), expansion=none (Text 1:1, keine %{}-Magie).
          const filter =
            `[0:v]scale=${REEL_W}:${REEL_H}:force_original_aspect_ratio=increase,` +
            `crop=${REEL_W}:${REEL_H},setsar=1[base];` +
            `[base][1:v]overlay=0:0[scr];` +
            `[scr]drawbox=x=${SIDE_MARGIN}:y=${REEL_H - BOTTOM_MARGIN}:` +
            `w=${ACCENT_W}:h=${ACCENT_H}:color=${accentColor}@1.0:t=fill[bar];` +
            `[bar]drawtext=fontfile=${FONT_PATH}:textfile=${capFile}:expansion=none:` +
            `fontcolor=white:fontsize=${CAPTION_FONT_SIZE}:` +
            `line_spacing=${CAPTION_LINE_SPACING}:x=${SIDE_MARGIN}:` +
            `y=h-${BOTTOM_MARGIN + CAPTION_GAP}-text_h:` +
            `shadowcolor=black@0.55:shadowx=0:shadowy=2[out]`;

          await execFileAsync(
            ffmpegBin,
            [
              "-y",
              "-nostdin",
              "-loglevel",
              "error",
              "-i",
              input,
              "-i",
              SCRIM_PATH,
              "-filter_complex",
              filter,
              "-map",
              "[out]",
              "-frames:v",
              "1",
              framePath,
            ],
            { timeout: FRAME_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
          );
        }
        frames.push(framePath);
      }
    } catch (error) {
      await fail("bake_frames", error);
      return;
    }

    // 4) Frames zum Reel zusammenfügen: jeder Frame 3 s, HARTE Schnitte
    //    (concat-Filter), h264 + yuv420p + +faststart, KEIN Audio. Die Frames
    //    sind bereits 1080x1920 → nur noch fps/sar setzen.
    const inputArgs: string[] = [];
    const filterParts: string[] = [];
    frames.forEach((frame, i) => {
      inputArgs.push("-loop", "1", "-t", String(SECONDS_PER_PHOTO), "-i", frame);
      // format=yuv420p vereinheitlicht die Frames: Captions-Frames sind nach dem
      // Scrim-Overlay evtl. RGBA, saubere Fotos RGB — concat verlangt EIN Format.
      filterParts.push(`[${i}:v]setsar=1,fps=${REEL_FPS},format=yuv420p[v${i}]`);
    });
    const concatInputs = frames.map((_, i) => `[v${i}]`).join("");
    const filterComplex =
      `${filterParts.join(";")};${concatInputs}concat=n=${frames.length}:v=1:a=0[outv]`;

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

    // 5) Upload nach order-media (service_role, upsert überschreibt ein altes Reel).
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

    // 6) Erfolg: reel_url = Storage-Pfad (Signed-URL erst beim Poll/Render),
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
    const cleanup = [...localPhotos, ...frames, ...captionFiles, outputPath];
    await Promise.all(
      cleanup.map((p) =>
        unlink(p).catch(() => {
          // ignorieren — Datei existiert evtl. nie (Fehler vor dem Schreiben).
        }),
      ),
    );
  }
}
