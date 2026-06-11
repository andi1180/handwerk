import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { displayCaption } from "@/lib/booklet/caption";
import { ensureFfmpeg, errMessage } from "@/lib/reel/ffmpeg";
import {
  assembleReel,
  assertReelAssets,
  bakeIntroFrame,
  bakeOutroFrame,
  bakePhotoFrame,
} from "@/lib/reel/frames";

/**
 * SCHRITT 8b-1c — Intro/Outro-Frames im Reel (+ optionales Logo-Wasserzeichen).
 *
 * Baut aus einem generierten Booklet ein 9:16-Reel (1080x1920, HARTE Schnitte,
 * KEIN Audio): ein Intro-Frame (~4 s) → die Foto-Frames (je 3 s, 8b-1a/1b) →
 * ein Outro-Frame (~2,5 s). Der eigentliche Render läuft in `after()` (Hintergrund
 * nach der Response, innerhalb maxDuration); der Fortschritt ist über
 * `booklets.reel_status` persistent (Poll + Reload).
 *
 *  - Intro:  intro_bg (Bild) oder Verlauf, Logo prominent oben, KI-Titel +
 *            persönliche Ich-Beschreibung (FIX 8b-1c) + Tagline.
 *  - Fotos:  Caption-Overlay (8b-1b); ZUSÄTZLICH bei logo_per_page ein dezentes
 *            Logo-Wasserzeichen in der oberen Ecke (analog Web-Story).
 *  - Outro:  outro_bg/Verlauf, Logo, Betriebsname + Nachricht + Kontakt
 *            (Telefon/Website). KEINE Share-/Review-Elemente (Step 9).
 *
 * Die gesamte ffmpeg-Filtergraph-Logik liegt in `lib/reel/frames.ts` — diese
 * Route ist reine Orchestrierung (Auth/Status/Downloads/Upload). NUR FFmpeg,
 * KEIN Sharp. Schrift + Scrims sind MITGELIEFERT und EXPLIZIT per Pfad
 * referenziert (kein fontconfig — der ist auf Vercel leer).
 *
 * KEINE Video-Clips (8b-2), KEIN Ken-Burns (8b-3).
 *
 * Node-Runtime erzwingen (Edge kann kein child_process / Binary ausführen) und
 * maxDuration anheben (Fluid Compute) — Download + ffmpeg + Upload dürfen dauern.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

/** Anzeigedauer je Foto im Reel (harte Schnitte, kein Übergang). */
const SECONDS_PER_PHOTO = 3;
/** Intro länger (FIX 8b-1c): die persönliche Ich-Story (Titel + Beschreibung)
 *  muss lesbar sein. Outro bleibt knapp (nur Marke + ein paar Zeilen). */
const INTRO_SECONDS = 4;
const OUTRO_SECONDS = 2.5;

type OrderRow = { id: string; business_id: string; status: string };
type BookletRow = {
  id: string;
  intro_title: string | null;
  intro_description: string | null;
};
type PhotoItem = {
  storage_path: string;
  caption: string | null;
  keyword: string | null;
};

/** Externer Link ohne Protokoll/Trailing-Slash (Anzeige-Form fürs Outro). */
function displayHost(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

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
  // setzen darauf den Render-Status und brauchen den KI-Intro-Titel. Strikt auf
  // die Order-business_id gescoped.
  const service = createServiceClient();
  const { data: booklet, error: bookletError } = await service
    .from("booklets")
    .select("id, intro_title, intro_description")
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

  // Outro-Kontaktzeilen aus den Settings (nur Telefon/Website, soweit gesetzt) —
  // KEINE Share-/Review-Elemente (Step 9). E-Mail/IG/Review bleiben der Web-Story.
  const contactLines: string[] = [];
  if (business.settings.contact_phone) contactLines.push(business.settings.contact_phone);
  if (business.settings.website_url) {
    contactLines.push(displayHost(business.settings.website_url));
  }

  // Heavy lifting NACH der Response (innerhalb maxDuration). Fehler landen in
  // reel_status='failed' + reel_error — der Client erfährt sie über den Poll.
  after(() =>
    renderReel({
      orderId: order.id,
      businessId: order.business_id,
      bookletId: booklet.id,
      photos,
      // Intro: KI-Titel (Fallback Betriebsname, wie die Web-Story) + die
      // persönliche Ich-Beschreibung (FIX 8b-1c) + Tagline.
      introTitle: booklet.intro_title?.trim() || business.name,
      introDescription: booklet.intro_description?.trim() || null,
      introTagline: business.settings.intro_tagline,
      // Outro: Betriebsname + Nachricht + Kontakt.
      businessName: business.name,
      outroMessage: business.settings.outro_message,
      contactLines,
      // Branding: Farben (Verlauf-Fallback + Akzente) und Storage-Pfade der Bilder.
      primaryColor: business.branding.primary_color,
      secondaryColor: business.branding.secondary_color,
      logoPerPage: business.branding.logo_per_page,
      logoPath: business.branding.logo_url,
      introBgPath: business.branding.intro_bg_url,
      outroBgPath: business.branding.outro_bg_url,
    }),
  );

  return NextResponse.json({ ok: true, status: "rendering" }, { status: 202 });
}

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
 * Branding-Assets (Logo/Intro-BG/Outro-BG) + Fotos nach /tmp laden → Intro-Frame,
 * Foto-Frames (cover-crop + Caption + optionales Wasserzeichen) und Outro-Frame
 * backen → Intro → Fotos → Outro zum 9:16-Reel fügen → nach `order-media`
 * hochladen → booklet auf 'ready' (mit reel_url = Storage-Pfad) bzw. bei jedem
 * Fehler auf 'failed' (+ reel_error). Alle Temp-Dateien werden aufgeräumt
 * (NICHT /tmp/ffmpeg — das bleibt gecacht).
 */
async function renderReel({
  orderId,
  businessId,
  bookletId,
  photos,
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
  photos: PhotoItem[];
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
  const localPhotos: string[] = [];
  const photoFrames: string[] = [];
  const assets: string[] = []; // heruntergeladene Logo-/Hintergrund-Dateien
  const introFrame = join(tmpDir, `intro-${randomUUID()}.png`);
  const outroFrame = join(tmpDir, `outro-${randomUUID()}.png`);
  const outputPath = join(tmpDir, `reel-${randomUUID()}.mp4`);

  // Caption pro Foto vorab auflösen (caption ?? keyword; beide leer ⇒ null =
  // sauberes Foto ohne Scrim). Gleiche Quelle wie die Web-Story (kein Drift).
  const captions = photos.map((p) => displayCaption(p));

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

    // 3) Fotos per service_role nach /tmp laden (Original-Extension behalten).
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

    // 4) Intro-Frame backen (Hintergrund/Verlauf + Logo + Titel + Tagline).
    try {
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
    } catch (error) {
      await fail("bake_intro", error);
      return;
    }

    // 5) Foto-Frames backen (cover-crop, Caption-Overlay, optionales Wasserzeichen).
    try {
      for (let i = 0; i < localPhotos.length; i++) {
        const framePath = join(tmpDir, `frame-${randomUUID()}.png`);
        await bakePhotoFrame({
          ffmpegBin,
          input: localPhotos[i]!,
          output: framePath,
          caption: captions[i] ?? null,
          logoPath: logoPerPage ? logoLocal : null,
          primaryColor,
        });
        photoFrames.push(framePath);
      }
    } catch (error) {
      await fail("bake_frames", error);
      return;
    }

    // 6) Outro-Frame backen (Hintergrund/Verlauf + Logo + Name + Nachricht + Kontakt).
    try {
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
    } catch (error) {
      await fail("bake_outro", error);
      return;
    }

    // 7) Assembly: Intro (2,5 s) → Fotos (je 3 s) → Outro (2,5 s), harte Schnitte.
    try {
      await assembleReel({
        ffmpegBin,
        output: outputPath,
        frames: [
          { path: introFrame, seconds: INTRO_SECONDS },
          ...photoFrames.map((path) => ({ path, seconds: SECONDS_PER_PHOTO })),
          { path: outroFrame, seconds: OUTRO_SECONDS },
        ],
      });
    } catch (error) {
      await fail("ffmpeg", error);
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
    const cleanup = [
      ...localPhotos,
      ...photoFrames,
      ...assets,
      introFrame,
      outroFrame,
      outputPath,
    ];
    await Promise.all(
      cleanup.map((p) =>
        unlink(p).catch(() => {
          // ignorieren — Datei existiert evtl. nie (Fehler vor dem Schreiben).
        }),
      ),
    );
  }
}
