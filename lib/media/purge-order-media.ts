import type { SupabaseClient } from "@supabase/supabase-js";
import { videoFramePaths } from "@/lib/media/video-frames";

/**
 * Medien-Purge eines Auftrags — **server-only**, geteilt zwischen dem Portal-
 * Route-Handler (`POST …/media/purge`, AUTHENTICATED + RLS) und einem späteren
 * Aufräum-Cron (`service_role`). Die Route enthält bewusst KEINE eigene
 * Lösch-Logik, damit beide Aufrufer garantiert dasselbe tun.
 *
 * ZWECK: Speicherplatz freigeben, **ohne die Analytics-Historie anzutasten**.
 * Gelöscht werden ausschließlich Medien und Medien-Referenzen:
 *
 *   1. alle `order_media`-ZEILEN dieses Auftrags (die Tabelle selbst bleibt),
 *   2. alle Storage-Dateien unter `{business_id}/{order_id}/` im Bucket
 *      `order-media`: die von `order_media` referenzierten Dateien, `reel.mp4`,
 *      `business-reel.mp4` und alle `*.frame-0/1/2.jpg` (Konventions-Pfade aus
 *      [lib/media/video-frames.ts](lib/media/video-frames.ts)),
 *   3. `booklets.reel_status` / `.business_reel_status` → `'purged'`, **NUR wenn
 *      der aktuelle Wert `'ready'` ist**.
 *
 * NICHT angefasst: die `orders`- und `booklets`-ZEILEN selbst sowie
 * `booklet_events`, `billing_events` und `analytics_events` — die vollständige
 * Historie zu erhalten ist der ganze Sinn dieser Funktion (statt den Auftrag zu
 * löschen).
 *
 * Die `'ready'`-Bedingung trägt die Bedeutung des Status: `'purged'` heißt „es
 * gab ein fertiges Reel, das gelöscht wurde". Ein nie gerendertes Reel bleibt
 * korrekt auf `'pending'`, ein gescheitertes auf `'failed'` — dieselbe Regel wie
 * im Nachlauf-UPDATE der Migration 0014.
 *
 * ISOLATION (§14.2): `businessId` kommt vom Aufrufer (Route: aus der Session)
 * und wird **jeder** Query als Filter mitgegeben — zusätzlich zur RLS, die beim
 * AUTHENTICATED Client ohnehin greift. Es wird nie eine business_id aus einem
 * Request-Body oder aus den Daten abgeleitet.
 *
 * Fehlerverhalten: die Funktion wirft nicht, sondern sammelt Fehler in
 * `errors` und meldet `ok: false`. Teil-Erfolge sind möglich und werden über die
 * Zähler sichtbar; ein erneuter Aufruf ist gefahrlos (idempotent — bereits
 * gelöschte Dateien/Zeilen führen nur zu Nullwerten).
 */

/** Bucket, in dem alle Auftragsmedien liegen. */
const BUCKET = "order-media";

/** Reel-Ausgaben: liegen per Konvention im Auftragsordner, ohne DB-Zeile. */
const REEL_OUTPUT_NAMES = ["reel.mp4", "business-reel.mp4", "reel-test.mp4"];

/** Storage `remove()` verträgt Batches; 50 hält die Requests klein. */
const REMOVE_CHUNK = 50;

export type PurgeOrderMediaResult = {
  /** true, wenn kein Schritt einen Fehler gemeldet hat. */
  ok: boolean;
  orderId: string;
  /** Gelöschte `order_media`-Zeilen. */
  mediaRowsDeleted: number;
  /** Tatsächlich aus dem Storage entfernte Objekte (API-Rückmeldung). */
  filesDeleted: number;
  /** Summe der Dateigrößen laut Listing (vor dem Löschen ermittelt). */
  bytesDeleted: number;
  /** Bequemlichkeit fürs Logging/UI — `bytesDeleted` in MB, 2 Nachkommastellen. */
  megabytesDeleted: number;
  /** Auf 'purged' gesetzte `booklets`-Zeilen (0 wenn nicht 'ready'). */
  reelStatusPurged: number;
  businessReelStatusPurged: number;
  /** Nicht-leer ⇒ mindestens ein Schritt ist gescheitert. */
  errors: string[];
};

type StorageEntry = { name: string; id: string | null; metadata: { size?: number } | null };

const baseName = (path: string) => path.split("/").pop() ?? path;
const isReelOutput = (path: string) => REEL_OUTPUT_NAMES.includes(baseName(path));
const isFrame = (path: string) => /\.frame-[012]\.jpg$/i.test(baseName(path));

/**
 * Listet den Auftragsordner vollständig auf (mit Paginierung). Der Ordner ist
 * per Konvention flach; ein Unterordner-Eintrag (`id === null`) wird defensiv
 * mitverfolgt, damit nichts übersehen wird.
 */
async function listOrderFolder(
  client: SupabaseClient,
  prefix: string,
): Promise<{ files: { path: string; size: number }[]; error: string | null }> {
  const files: { path: string; size: number }[] = [];
  const queue: string[] = [prefix];
  const LIMIT = 1000;

  while (queue.length > 0) {
    const current = queue.shift() as string;
    let offset = 0;
    for (;;) {
      const { data, error } = await client.storage
        .from(BUCKET)
        .list(current, { limit: LIMIT, offset });
      if (error) return { files, error: `list(${current}): ${error.message}` };
      const entries = (data ?? []) as StorageEntry[];
      if (entries.length === 0) break;
      for (const entry of entries) {
        const full = `${current}/${entry.name}`;
        if (entry.id === null || entry.id === undefined) queue.push(full);
        else
          files.push({
            path: full,
            size: typeof entry.metadata?.size === "number" ? entry.metadata.size : 0,
          });
      }
      if (entries.length < LIMIT) break;
      offset += entries.length;
    }
  }
  return { files, error: null };
}

export async function purgeOrderMedia(
  client: SupabaseClient,
  { orderId, businessId }: { orderId: string; businessId: string },
): Promise<PurgeOrderMediaResult> {
  const errors: string[] = [];
  const result: PurgeOrderMediaResult = {
    ok: true,
    orderId,
    mediaRowsDeleted: 0,
    filesDeleted: 0,
    bytesDeleted: 0,
    megabytesDeleted: 0,
    reelStatusPurged: 0,
    businessReelStatusPurged: 0,
    errors,
  };

  // ── 1) Medien-Zeilen laden (liefert die referenzierten Storage-Pfade) ──────
  const { data: mediaRows, error: mediaError } = await client
    .from("order_media")
    .select("id, media_type, storage_path")
    .eq("order_id", orderId)
    .eq("business_id", businessId)
    .returns<{ id: string; media_type: string; storage_path: string }[]>();
  if (mediaError) errors.push(`load_media: ${mediaError.message}`);
  const rows = mediaRows ?? [];

  // ── 2) Löschmenge bestimmen ───────────────────────────────────────────────
  // Basis ist das Listing des Auftragsordners: so werden auch Dateien erfasst,
  // die keine (mehr) DB-Zeile haben — Reel-Ausgaben (per Konvention ohne Zeile)
  // und verwaiste Frames eines bereits gelöschten Videos.
  const prefix = `${businessId}/${orderId}`;
  const { files, error: listError } = await listOrderFolder(client, prefix);
  if (listError) errors.push(listError);

  const sizeByPath = new Map(files.map((f) => [f.path, f.size]));
  const targets = new Set<string>();

  for (const file of files) {
    if (isReelOutput(file.path) || isFrame(file.path)) targets.add(file.path);
  }
  // Von order_media referenzierte Dateien + deren Konventions-Frames — auch dann,
  // wenn das Listing sie (z. B. wegen eines Fehlers) nicht geliefert hat.
  for (const row of rows) {
    targets.add(row.storage_path);
    if (row.media_type === "video") {
      for (const framePath of videoFramePaths(row.storage_path)) targets.add(framePath);
    }
  }
  // Alles, was im Listing auftauchte und zu einer Medien-Zeile gehört, ist damit
  // ebenfalls erfasst; übrig bleiben nur Fremddateien, die bewusst liegenbleiben.

  const paths = [...targets];
  result.bytesDeleted = paths.reduce((sum, p) => sum + (sizeByPath.get(p) ?? 0), 0);
  result.megabytesDeleted = Number((result.bytesDeleted / 1024 / 1024).toFixed(2));

  // ── 3) Storage-Dateien entfernen ──────────────────────────────────────────
  // Zuerst der Storage, dann die Zeilen: schlägt der Storage-Teil fehl, bleiben
  // die Zeilen (und damit die Pfade) erhalten und ein Retry findet sie wieder.
  for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
    const slice = paths.slice(i, i + REMOVE_CHUNK);
    const { data, error } = await client.storage.from(BUCKET).remove(slice);
    if (error) errors.push(`remove_files: ${error.message}`);
    else result.filesDeleted += (data ?? []).length;
  }

  // ── 4) order_media-Zeilen löschen (Tabelle bleibt, nur die Zeilen gehen) ──
  const { data: deletedRows, error: deleteError } = await client
    .from("order_media")
    .delete()
    .eq("order_id", orderId)
    .eq("business_id", businessId)
    .select("id");
  if (deleteError) errors.push(`delete_rows: ${deleteError.message}`);
  else result.mediaRowsDeleted = (deletedRows ?? []).length;

  // ── 5) Reel-Status auf 'purged' — NUR aus 'ready' heraus ──────────────────
  const { data: reelUpdated, error: reelError } = await client
    .from("booklets")
    .update({ reel_status: "purged" })
    .eq("order_id", orderId)
    .eq("business_id", businessId)
    .eq("reel_status", "ready")
    .select("id");
  if (reelError) errors.push(`purge_reel_status: ${reelError.message}`);
  else result.reelStatusPurged = (reelUpdated ?? []).length;

  const { data: bizUpdated, error: bizError } = await client
    .from("booklets")
    .update({ business_reel_status: "purged" })
    .eq("order_id", orderId)
    .eq("business_id", businessId)
    .eq("business_reel_status", "ready")
    .select("id");
  if (bizError) errors.push(`purge_business_reel_status: ${bizError.message}`);
  else result.businessReelStatusPurged = (bizUpdated ?? []).length;

  result.ok = errors.length === 0;
  return result;
}
