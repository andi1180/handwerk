import { constants as fsConstants } from "node:fs";
import { access, chmod, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Server-only FFmpeg-Bereitstellung (Schritt 8b-1a, extrahiert aus dem 8b-0v2-Spike).
 *
 * Das ffmpeg-Binary wird NICHT ins Function-Bundle gepackt (das sprengte in 8b-0
 * den Vercel-Deploy), sondern zur LAUFZEIT aus dem privaten Supabase-Bucket
 * `assets` nach `/tmp` geladen — einmalig pro warmer Instanz, danach gecacht.
 *
 * Dieselbe Logik wird vom echten Reel-Render (`render-reel`) genutzt; kein Spike
 * mehr. next.config bleibt unangetastet (kein serverExternalPackages/Tracing).
 */

const gunzipAsync = promisify(gunzip);

/** Ziel des Binaries in der (ephemeren) Function — nur `/tmp` ist beschreibbar. */
const FFMPEG_BIN = join(tmpdir(), "ffmpeg");

/** Quelle in Supabase (per Script einmalig befüllt, s. scripts/upload-ffmpeg.ts).
 *  Gzip-komprimiert (~28 MB) — passt unter das Supabase-Storage-Limit (Default
 *  50 MB); wird beim Cold-Start zur Laufzeit entpackt. */
const FFMPEG_BUCKET = "assets";
const FFMPEG_OBJECT = "ffmpeg/linux-x64.gz";

/** Echte Fehlermeldung für die Server-Logs (Vercel) extrahieren. */
export function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Stellt das ausführbare ffmpeg-Binary in `/tmp` bereit und gibt seinen Pfad
 * zurück.
 *
 *  - **Warme Instanz:** liegt `/tmp/ffmpeg` schon (ausführbar) vor ⇒ Download
 *    überspringen (Cache über Function-Invocations hinweg).
 *  - **Cold Start:** das gzip-komprimierte Binary aus `assets/ffmpeg/linux-x64.gz`
 *    (service_role, `download`) laden, zur Laufzeit **entpacken** (`gunzip`) und
 *    **atomar** schreiben (Temp-Datei → chmod 0o755 → rename). Das rename
 *    verhindert, dass ein halb geschriebenes Binary als „vorhanden" gecacht
 *    wird, falls zwei Cold-Starts gleichzeitig laden.
 *
 * Wirft bei jedem Fehlschlag — der Aufrufer übersetzt das in `ffmpeg_unavailable`.
 */
export async function ensureFfmpeg(): Promise<string> {
  try {
    await access(FFMPEG_BIN, fsConstants.X_OK);
    return FFMPEG_BIN; // warm — vollständig (atomar geschrieben)
  } catch {
    // nicht vorhanden / nicht ausführbar → laden
  }

  const service = createServiceClient();
  const { data, error } = await service.storage
    .from(FFMPEG_BUCKET)
    .download(FFMPEG_OBJECT);
  if (error || !data) {
    throw new Error(`ffmpeg download failed: ${error?.message ?? "no data"}`);
  }

  // Gzip → roh entpacken; das dekomprimierte Binary (~76 MB) nach /tmp schreiben.
  const gz = Buffer.from(await data.arrayBuffer());
  const binary = await gunzipAsync(gz);
  const tmpBin = `${FFMPEG_BIN}.${randomUUID()}.tmp`;
  await writeFile(tmpBin, binary);
  await chmod(tmpBin, 0o755);
  await rename(tmpBin, FFMPEG_BIN);
  return FFMPEG_BIN;
}
