import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, chmod, rename, unlink, writeFile } from "node:fs/promises";
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
const execFileAsync = promisify(execFile);

/**
 * Ziel des Binaries in der (ephemeren) Function — nur `/tmp` ist beschreibbar.
 *
 * VERSIONIERT (`-v2`, 8b-1b): Der Cache-Dateiname trägt eine Version, damit ein
 * **Binary-Wechsel** garantiert neu lädt. Eine warme Instanz, die noch das alte
 * (drawtext-lose) `/tmp/ffmpeg` hält, würde es sonst weiter cachen; der neue
 * Pfad erzwingt nach dem Re-Upload + Re-Deploy einen frischen Download des
 * drawtext-fähigen Builds. Bei künftigen Binary-Wechseln hochzählen.
 */
const FFMPEG_BIN = join(tmpdir(), "ffmpeg-v2");

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
 * Selbstcheck: stellt sicher, dass das Binary den `drawtext`-Filter kann
 * (libfreetype einkompiliert). Das alte b6.1.1-Binary war OHNE libfreetype gebaut
 * → die Caption-Overlays (8b-1b) scheiterten erst spät bei `bake_frames`
 * ("No such filter: 'drawtext'"). Hier prüfen wir es EINMAL pro Cold-Start (vor
 * dem atomaren `rename` → ein gecachtes Binary ist garantiert geprüft-gut) und
 * werfen einen klaren `drawtext_missing`-Fehler, falls der Filter fehlt.
 *
 * `ffmpeg -filters` listet pro Zeile einen Filter; der Selbstcheck ist günstig
 * (~zig ms) und läuft nur beim Download, nicht bei jedem Render.
 */
async function assertDrawtext(binPath: string): Promise<void> {
  let listing: string;
  try {
    const { stdout, stderr } = await execFileAsync(
      binPath,
      ["-hide_banner", "-filters"],
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    );
    listing = `${stdout}\n${stderr}`;
  } catch (error) {
    throw new Error(`drawtext_missing: ffmpeg -filters failed: ${errMessage(error)}`);
  }
  if (!/\bdrawtext\b/.test(listing)) {
    throw new Error(
      "drawtext_missing: ffmpeg build has no drawtext filter (libfreetype not compiled in)",
    );
  }
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

  // Gzip → roh entpacken; das dekomprimierte Binary (~78 MB) nach /tmp schreiben.
  const gz = Buffer.from(await data.arrayBuffer());
  const binary = await gunzipAsync(gz);
  const tmpBin = `${FFMPEG_BIN}.${randomUUID()}.tmp`;
  await writeFile(tmpBin, binary);
  await chmod(tmpBin, 0o755);

  // drawtext-Selbstcheck VOR dem rename: schlägt er fehl, wird das halbe Binary
  // verworfen (kein Cache eines drawtext-losen Builds) und ein klarer Fehler
  // geworfen — statt erst später bei `bake_frames` zu scheitern.
  try {
    await assertDrawtext(tmpBin);
  } catch (error) {
    await unlink(tmpBin).catch(() => {});
    throw error;
  }

  await rename(tmpBin, FFMPEG_BIN);
  return FFMPEG_BIN;
}
