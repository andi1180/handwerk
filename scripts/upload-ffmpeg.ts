/**
 * scripts/upload-ffmpeg.ts — EINMALIG lokal ausführen (Schritt 8b-0v2).
 *
 * Lädt die statisch gelinkte linux-x64-ffmpeg-Binary von einer GEPINNTEN Quelle
 * (ffmpeg-static GitHub-Release) **gzip-komprimiert** (~28 MB) und legt sie im
 * privaten Supabase-Bucket `assets` unter `ffmpeg/linux-x64.gz` ab. Die Render-
 * Route lädt sie zur LAUFZEIT, entpackt sie und schreibt sie nach `/tmp` (statt
 * sie ins Vercel-Function-Bundle zu packen — das sprengte in 8b-0 den Deploy).
 *
 * Warum gzip? Das rohe Binary (~76 MB) überschreitet das projektweite Supabase-
 * Storage-Limit (Default 50 MB); die komprimierten ~28 MB passen darunter, ohne
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
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";

/**
 * GEPINNTE Quelle: ffmpeg-static Release `b6.1.1`, Asset `ffmpeg-linux-x64.gz`.
 * Das ist ein **statisch** gelinkter Build (John Van Sickle) — läuft auf Vercels
 * Amazon Linux ohne glibc-Probleme. URL + Größen sind verifiziert; bei einem
 * Versions-Bump alle drei Konstanten hier anpassen (nicht raten).
 */
const FFMPEG_VERSION = "b6.1.1";
const FFMPEG_URL = `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_VERSION}/ffmpeg-linux-x64.gz`;
const EXPECTED_GZ_BYTES = 29_354_986;
const EXPECTED_BIN_BYTES = 79_826_272;

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
  //    Default-Limit (50 MB) reicht für die ~28-MB-gz.
  console.log(`[1/3] Bucket "${BUCKET}" sicherstellen…`);
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

  // 2) Gzip-Binary laden + Integrität prüfen (gzip-Magic + Größe; dann entpacken
  //    und das Ergebnis als ELF + erwartete Größe verifizieren).
  console.log(`[2/3] ffmpeg laden: ${FFMPEG_URL}`);
  const res = await fetch(FFMPEG_URL);
  if (!res.ok) {
    console.error(`      Download fehlgeschlagen: HTTP ${res.status}`);
    process.exit(1);
  }
  const gz = Buffer.from(await res.arrayBuffer());
  console.log(`      Geladen (gz): ${gz.byteLength} Bytes`);

  const isGzip = gz.length > 2 && gz[0] === 0x1f && gz[1] === 0x8b;
  if (!isGzip) {
    console.error("      Kein gzip (Magic 1F 8B) — falsche Quelle?");
    process.exit(1);
  }
  if (gz.byteLength !== EXPECTED_GZ_BYTES) {
    console.error(
      `      gz-Größe weicht ab (erwartet ${EXPECTED_GZ_BYTES}, erhalten ${gz.byteLength}) — Quelle/Version geändert?`,
    );
    process.exit(1);
  }

  const binary = gunzipSync(gz);
  const isElf =
    binary.length > 4 &&
    binary[0] === 0x7f &&
    binary[1] === 0x45 &&
    binary[2] === 0x4c &&
    binary[3] === 0x46;
  if (!isElf) {
    console.error("      Entpackt ist kein ELF-Binary (Magic 7F 45 4C 46).");
    process.exit(1);
  }
  if (binary.byteLength !== EXPECTED_BIN_BYTES) {
    console.error(
      `      Entpackte Größe weicht ab (erwartet ${EXPECTED_BIN_BYTES}, erhalten ${binary.byteLength}).`,
    );
    process.exit(1);
  }
  console.log(`      Entpackt verifiziert (ELF): ${binary.byteLength} Bytes`);

  // 3) Upload der gz (upsert überschreibt eine vorige Version idempotent).
  console.log(`[3/3] Upload → ${BUCKET}/${OBJECT_PATH} …`);
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
    `✅ Fertig: ${BUCKET}/${OBJECT_PATH} (${gz.byteLength} Bytes gz, ffmpeg ${FFMPEG_VERSION}).`,
  );
}

main().catch((error: unknown) => {
  console.error(
    "Unerwarteter Fehler:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
