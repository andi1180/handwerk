/**
 * scripts/upload-ffmpeg.ts — EINMALIG lokal ausführen (Schritt 8b-0v2, Quelle in
 * 8b-1b auf ein drawtext-fähiges Build gewechselt).
 *
 * Lädt eine statisch gelinkte linux-x64-ffmpeg-Binary von einer GEPINNTEN Quelle,
 * extrahiert **nur** das `ffmpeg`-Binary (das Archiv enthält ffmpeg + ffprobe;
 * ffprobe brauchen wir nicht), **gzip-komprimiert** es (~29 MB) und legt es im
 * privaten Supabase-Bucket `assets` unter `ffmpeg/linux-x64.gz` ab. Die Render-
 * Route lädt es zur LAUFZEIT, entpackt es und schreibt es nach `/tmp` (statt es
 * ins Vercel-Function-Bundle zu packen — das sprengte in 8b-0 den Deploy).
 *
 * QUELLE GEWECHSELT (8b-1b): Das bisherige `eugeneware/ffmpeg-static`-Binary
 * (b6.1.1) war OHNE libfreetype gebaut — der `drawtext`-Filter fehlte ("No such
 * filter: 'drawtext'"), und die Caption-Overlays (8b-1b) scheiterten erst zur
 * Render-Zeit. Ersetzt durch den **John-Van-Sickle-Static-Build** (voll
 * ausgestattet, `--enable-libfreetype --enable-fontconfig` → drawtext vorhanden,
 * statisch gelinkt → läuft auf Vercels Amazon Linux ohne glibc-Probleme).
 *
 * Lizenz: Es ist ein **GPLv3**-Static-Build (`--enable-gpl --enable-version3`).
 * Wir nutzen ffmpeg ausschließlich **server-seitig zum Rendern** und geben die
 * Binary NICHT an Endkunden weiter — das ist mit der GPL vereinbar (keine
 * Distribution = keine Quelltext-Mitgabepflicht gegenüber Dritten). Quelle des
 * Builds: https://johnvansickle.com/ffmpeg/ (statische Linux-Builds).
 *
 * Warum gzip? Das rohe Binary (~78 MB) überschreitet das projektweite Supabase-
 * Storage-Limit (Default 50 MB); die komprimierten ~29 MB passen darunter, ohne
 * eine projektweite Dashboard-Einstellung ändern zu müssen.
 *
 * Warum per Script statt SQL-Migration? Der Bucket trägt **kein** Mandanten-Datum
 * und braucht **keine** RLS — er wird ausschließlich serverseitig über
 * `service_role` gelesen. Ein App-internes Infra-Asset gehört nicht in die
 * tenant-orientierten Migrationen (0001…).
 *
 * Run (einmalig, liest Keys aus .env.local):
 *
 *     pnpm dlx tsx scripts/upload-ffmpeg.ts
 *
 * Benötigt SUPABASE_URL (oder NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.
 * service_role ist server-/CLI-only — NIE in den Client.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";

/**
 * GEPINNTE Quelle: John Van Sickle Static-Build `ffmpeg-6.0.1-amd64-static`.
 * Statisch gelinkt (läuft auf Amazon Linux ohne glibc-Probleme), GPLv3, **mit**
 * libfreetype/fontconfig → drawtext-Filter vorhanden (für die Caption-Overlays).
 *
 * Die `old-releases/`-URL ist versions-stabil (anders als der bewegliche
 * `releases/ffmpeg-release-amd64-static.tar.xz`-Link, der immer auf das neueste
 * Release zeigt) — daher hier gepinnt. URL + Größen sind verifiziert; bei einem
 * Versions-Bump alle Konstanten hier anpassen (nicht raten).
 */
const FFMPEG_VERSION = "6.0.1";
const FFMPEG_URL = `https://johnvansickle.com/ffmpeg/old-releases/ffmpeg-${FFMPEG_VERSION}-amd64-static.tar.xz`;
/** Pfad des `ffmpeg`-Binaries IM Archiv (Ordnername = Build-Name). */
const ARCHIVE_MEMBER = `ffmpeg-${FFMPEG_VERSION}-amd64-static/ffmpeg`;
/** Verifizierte Größen (Integrität): tar.xz-Download bzw. entpacktes Binary. */
const EXPECTED_TARXZ_BYTES = 41_164_188;
const EXPECTED_BIN_BYTES = 78_714_496;
/** Projektweites Supabase-Storage-Limit (Default) — die gz MUSS darunter bleiben. */
const SUPABASE_SIZE_LIMIT = 50 * 1024 * 1024;

const BUCKET = "assets";
const OBJECT_PATH = "ffmpeg/linux-x64.gz";

/**
 * Minimaler .env-Loader (dependency-frei, typsicher): setzt nur Keys, die noch
 * nicht in der Umgebung stehen. Service-Keys sind JWTs/URLs ohne `=` im Wert →
 * Split am ersten `=` ist sicher.
 */
function loadEnvFile(path: string): void {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return; // Datei fehlt → ignorieren
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function main(): Promise<void> {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Fehlt: SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL und/oder SUPABASE_SERVICE_ROLE_KEY (.env.local).",
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Bucket idempotent anlegen (privat, App-intern, keine RLS). KEIN
  //    fileSizeLimit > globalem Limit setzen — das lehnt Supabase ab; das
  //    Default-Limit (50 MB) reicht für die ~29-MB-gz.
  console.log(`[1/4] Bucket "${BUCKET}" sicherstellen…`);
  const { error: bucketError } = await supabase.storage.createBucket(BUCKET, {
    public: false,
  });
  if (bucketError) {
    const msg = bucketError.message.toLowerCase();
    if (msg.includes("exist")) {
      console.log("      Bucket existiert bereits — ok.");
    } else {
      console.error(`      createBucket fehlgeschlagen: ${bucketError.message}`);
      process.exit(1);
    }
  } else {
    console.log(`      Bucket "${BUCKET}" angelegt (privat).`);
  }

  // 2) tar.xz laden + Integrität prüfen (xz-Magic + Größe).
  console.log(`[2/4] ffmpeg laden: ${FFMPEG_URL}`);
  const res = await fetch(FFMPEG_URL);
  if (!res.ok) {
    console.error(`      Download fehlgeschlagen: HTTP ${res.status}`);
    process.exit(1);
  }
  const tarxz = Buffer.from(await res.arrayBuffer());
  console.log(`      Geladen (tar.xz): ${tarxz.byteLength} Bytes`);

  const isXz =
    tarxz.length > 6 &&
    tarxz[0] === 0xfd &&
    tarxz[1] === 0x37 &&
    tarxz[2] === 0x7a &&
    tarxz[3] === 0x58 &&
    tarxz[4] === 0x5a &&
    tarxz[5] === 0x00;
  if (!isXz) {
    console.error("      Kein xz (Magic FD 37 7A 58 5A 00) — falsche Quelle?");
    process.exit(1);
  }
  if (tarxz.byteLength !== EXPECTED_TARXZ_BYTES) {
    console.error(
      `      tar.xz-Größe weicht ab (erwartet ${EXPECTED_TARXZ_BYTES}, erhalten ${tarxz.byteLength}) — Quelle/Version geändert?`,
    );
    process.exit(1);
  }

  // 3) Nur das `ffmpeg`-Binary aus dem Archiv extrahieren (ffprobe verwerfen) und
  //    als ELF + erwartete Größe verifizieren. `tar` shellt sich kurz aus — das
  //    ist ein einmaliges lokales Script (kein Laufzeitpfad), und Node hat keine
  //    eingebaute xz-Dekompression.
  console.log(`[3/4] ffmpeg-Binary extrahieren (${ARCHIVE_MEMBER}) …`);
  const workDir = mkdtempSync(join(tmpdir(), "ffmpeg-upload-"));
  let binary: Buffer;
  try {
    const tarxzPath = join(workDir, "ffmpeg.tar.xz");
    writeFileSync(tarxzPath, tarxz);
    execFileSync("tar", ["-xJf", tarxzPath, "-C", workDir, ARCHIVE_MEMBER], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    binary = readFileSync(join(workDir, ARCHIVE_MEMBER));
  } catch (error) {
    console.error(
      `      Extraktion fehlgeschlagen: ${error instanceof Error ? error.message : error}`,
    );
    rmSync(workDir, { recursive: true, force: true });
    process.exit(1);
  }
  rmSync(workDir, { recursive: true, force: true });

  const isElf =
    binary.length > 4 &&
    binary[0] === 0x7f &&
    binary[1] === 0x45 &&
    binary[2] === 0x4c &&
    binary[3] === 0x46;
  if (!isElf) {
    console.error("      Extrahiert ist kein ELF-Binary (Magic 7F 45 4C 46).");
    process.exit(1);
  }
  if (binary.byteLength !== EXPECTED_BIN_BYTES) {
    console.error(
      `      Binary-Größe weicht ab (erwartet ${EXPECTED_BIN_BYTES}, erhalten ${binary.byteLength}).`,
    );
    process.exit(1);
  }
  console.log(`      Extrahiert verifiziert (ELF): ${binary.byteLength} Bytes`);

  // 4) Binary gzippen + gegen das Supabase-Limit prüfen, dann hochladen (upsert
  //    überschreibt das alte b6.1.1-Binary idempotent).
  const gz = gzipSync(binary, { level: 9 });
  console.log(
    `[4/4] gz: ${gz.byteLength} Bytes (Limit ${SUPABASE_SIZE_LIMIT}) → Upload ${BUCKET}/${OBJECT_PATH} …`,
  );
  if (gz.byteLength >= SUPABASE_SIZE_LIMIT) {
    console.error(
      `      gz (${gz.byteLength}) ≥ Supabase-Limit (${SUPABASE_SIZE_LIMIT}) — nicht hochladen. Kleinere Quelle wählen oder Limit anheben.`,
    );
    process.exit(1);
  }
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(OBJECT_PATH, gz, {
      contentType: "application/gzip",
      upsert: true,
    });
  if (uploadError) {
    console.error(`      Upload fehlgeschlagen: ${uploadError.message}`);
    process.exit(1);
  }

  console.log(
    `✅ Fertig: ${BUCKET}/${OBJECT_PATH} (${gz.byteLength} Bytes gz, ffmpeg ${FFMPEG_VERSION}, drawtext-fähig).`,
  );
}

main().catch((error: unknown) => {
  console.error(
    "Unerwarteter Fehler:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
