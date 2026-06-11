import { execFile } from "node:child_process";
import { chmod, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import ffmpegPath from "ffmpeg-static";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentBusiness } from "@/lib/auth/current-business";

/**
 * SCHRITT 8b-0 — FFmpeg-Infra-Spike. Beweist NUR die Machbarkeit: ffmpeg läuft
 * in der Vercel-Function und der Output landet abspielbar im Storage. KEINE
 * echte Reel-Pipeline, KEIN Intro/Outro/Caption, KEINE Migration. Das echte
 * „Reel erstellen" ersetzt diese provisorische Route in 8b-1.
 *
 * Erzeugt ein triviales 9:16-mp4 (1080x1920, ~2s, h264/yuv420p, ohne Audio) in
 * /tmp, lädt es per service_role in den Bucket `order-media` und gibt eine
 * Signed-URL zurück.
 *
 * Node-Runtime erzwingen (Edge kann kein child_process / Binary ausführen) und
 * maxDuration anheben (Fluid Compute) — ffmpeg darf etwas dauern.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

/** Echte Fehlermeldung für die Server-Logs (Vercel) extrahieren. */
function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const execFileAsync = promisify(execFile);

/** ffmpeg darf nie hängen — nach diesem Timeout wird der Prozess gekillt. */
const FFMPEG_TIMEOUT_MS = 120_000;

/** Signed-URL-Lebensdauer (privater Bucket gibt nichts dauerhaft frei). */
const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * POST /api/portal/orders/[id]/render-reel-test
 *
 * Guards (alle vor jedem Rendern/Schreiben):
 *  - AUTHENTICATED Server-Client; kein User ⇒ 401, kein Betrieb ⇒ 403.
 *  - Order über RLS geladen (fremde/fehlende id ⇒ 404). Die `business_id` stammt
 *    AUS DER GELADENEN ORDER (über RLS gegen die Session validiert), NIE aus dem
 *    Body — sie ist das erste Storage-Pfad-Segment und damit die Mandanten-Grenze.
 *
 * ISOLATION: Der Storage-Write läuft über `service_role` (umgeht RLS). Der Pfad
 * `{business_id}/{order_id}/reel-test.mp4` ist strikt auf die Order-business_id
 * gescoped; das erste Segment = business_id deckt die bestehende 0002-Policy ab.
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
  // vertrauenswürdig (Session-Betrieb), einzige Quelle für den Storage-Pfad.
  const { data: order } = await supabase
    .from("orders")
    .select("id, business_id")
    .eq("id", orderId)
    .maybeSingle<{ id: string; business_id: string }>();
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // ffmpeg-static liefert den Binary-Pfad (null nur auf nicht unterstützten
  // Plattformen). Fehlt er, hat das Bundling nicht gegriffen ⇒ klarer 500.
  if (!ffmpegPath) {
    console.error("render-reel-test: ffmpeg binary unavailable", {
      order_id: order.id,
      step: "ffmpeg_resolve",
    });
    return NextResponse.json({ error: "ffmpeg_unavailable" }, { status: 500 });
  }

  const storagePath = `${order.business_id}/${order.id}/reel-test.mp4`;
  const tmpPath = join(tmpdir(), `reel-test-${randomUUID()}.mp4`);

  try {
    // Ausführbar-Bit defensiv setzen — Tracing/Bundling kann es auf manchen
    // Plattformen strippen. Nicht fatal: schlägt es fehl (z. B. read-only FS,
    // Bit schon gesetzt), zeigt der eigentliche exec-Versuch das echte Problem.
    try {
      await chmod(ffmpegPath, 0o755);
    } catch (error) {
      console.error("render-reel-test: chmod failed (non-fatal)", {
        order_id: order.id,
        step: "chmod",
        message: errMessage(error),
      });
    }

    // Triviales 1080x1920-mp4, ~2s, einfarbig. -pix_fmt yuv420p für maximale
    // Player-Kompatibilität (Safari/QuickTime), -movflags +faststart fürs Web,
    // -an kein Audio. Timeout killt einen hängenden Prozess (kein Dauer-Hänger).
    try {
      await execFileAsync(
        ffmpegPath,
        [
          "-y",
          "-nostdin",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=c=0x1A1A1A:s=1080x1920:d=2",
          "-pix_fmt",
          "yuv420p",
          "-c:v",
          "libx264",
          "-movflags",
          "+faststart",
          "-an",
          tmpPath,
        ],
        { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      );
    } catch (error) {
      console.error("render-reel-test: ffmpeg failed", {
        order_id: order.id,
        step: "ffmpeg",
        message: errMessage(error),
      });
      return NextResponse.json({ error: "ffmpeg_failed" }, { status: 500 });
    }

    // Output → Storage (service_role, umgeht RLS), upsert überschreibt einen
    // vorigen Test. contentType video/mp4, damit die Signed-URL abspielbar ist.
    try {
      const fileBuffer = await readFile(tmpPath);
      const service = createServiceClient();
      const { error: uploadError } = await service.storage
        .from("order-media")
        .upload(storagePath, fileBuffer, {
          contentType: "video/mp4",
          upsert: true,
        });
      if (uploadError) {
        console.error("render-reel-test: upload failed", {
          order_id: order.id,
          step: "upload",
          message: uploadError.message,
        });
        return NextResponse.json({ error: "upload_failed" }, { status: 500 });
      }

      const { data: signed, error: signError } = await service.storage
        .from("order-media")
        .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
      if (signError || !signed?.signedUrl) {
        console.error("render-reel-test: sign failed", {
          order_id: order.id,
          step: "sign",
          message: signError?.message ?? "no signed url",
        });
        return NextResponse.json({ error: "sign_failed" }, { status: 500 });
      }

      return NextResponse.json({ ok: true, url: signed.signedUrl }, { status: 200 });
    } catch (error) {
      console.error("render-reel-test: storage step failed", {
        order_id: order.id,
        step: "storage",
        message: errMessage(error),
      });
      return NextResponse.json({ error: "upload_failed" }, { status: 500 });
    }
  } finally {
    // Temp-Datei immer aufräumen (ENOENT etc. ignorieren — Spike, /tmp ist eh
    // ephemer). Kein await-Leak: Cleanup blockiert die Antwort nicht spürbar.
    try {
      await unlink(tmpPath);
    } catch {
      // ignorieren — Datei existiert evtl. nie (ffmpeg-Fehler vor Output).
    }
  }
}
