/**
 * Selbstheilung hängender Betriebsreel-Renders (plain, keine Imports).
 *
 * Problem: `render-business-reel` setzt `booklets.business_reel_status =
 * 'rendering'` und rendert danach in `after()`. Wird die Vercel-Instanz hart
 * abgebrochen (OOM / Timeout), kann der `after()`-Block kein `'failed'` mehr
 * schreiben — die Zeile bliebe für immer auf `'rendering'`.
 *
 * Lösung: ein `'rendering'`, das länger als `STALE_RENDER_MS` nicht angefasst
 * wurde, gilt als abgebrochen. Maßstab ist `booklets.updated_at` — der
 * BEFORE-UPDATE-Trigger `trg_booklets_updated` (0001) setzt es bei JEDEM
 * Update auf `now()`, also auch beim Wechsel auf `'rendering'`.
 *
 * Grenze: andere Updates derselben Booklet-Zeile (Kundenreel fertig,
 * `viewed_at`, `first_shared_at` …) verschieben `updated_at` ebenfalls nach
 * hinten. Das verzögert die Erkennung höchstens — es kann NIE ein noch
 * laufender Render vorzeitig als abgebrochen gelten.
 *
 * Bewusst ohne Server-/DB-Imports ⇒ direkt mit `node --test` prüfbar.
 */

/**
 * `maxDuration` der Render-Route ist 300 s; danach beendet Vercel die
 * Funktion samt `after()`. Plus eine Minute Puffer.
 */
export const STALE_RENDER_MS = 6 * 60 * 1000;

/**
 * Client-seitige Notbremse im `BusinessReelButton`: bleibt der Status so
 * lange auf `'rendering'`, hört der Button auf zu pollen und zeigt den
 * Fehlerzustand mit „Neu erstellen". Liegt bewusst ÜBER `STALE_RENDER_MS`,
 * damit im Normalfall die Server-Selbstheilung zuerst greift.
 */
export const CLIENT_RENDER_TIMEOUT_MS = 8 * 60 * 1000;

/** Grenzzeitpunkt: Zeilen mit `updated_at` VOR diesem Wert sind stale. */
export function staleCutoff(now: Date): Date {
  return new Date(now.getTime() - STALE_RENDER_MS);
}

/**
 * true ⇔ `status === 'rendering'` UND `updatedAt` liegt STRIKT vor dem
 * Grenzzeitpunkt (`now - STALE_RENDER_MS`). Genau am Limit gilt die Zeile
 * noch als laufend — konsistent mit dem `.lt('updated_at', cutoff)` im
 * bedingten DB-Update.
 *
 * Fehlt `updatedAt` oder ist er unlesbar, wird NICHT geheilt: ohne
 * Zeitstempel lässt sich kein Abbruch belegen (die Spalte ist `not null`,
 * der Fall ist also nur defensiv).
 */
export function isStaleRendering(
  status: string | null | undefined,
  updatedAt: string | Date | null | undefined,
  now: Date,
): boolean {
  if (status !== "rendering") return false;
  if (updatedAt === null || updatedAt === undefined) return false;
  const ts =
    updatedAt instanceof Date ? updatedAt.getTime() : Date.parse(updatedAt);
  if (!Number.isFinite(ts)) return false;
  return ts < staleCutoff(now).getTime();
}

export type RenderLockRow = {
  order_id: string;
  business_reel_status: string | null;
  updated_at: string | null;
};

/**
 * Parallel-Sperre für `render-business-reel`: true ⇔ derselbe Betrieb hat
 * bei einem ANDEREN Auftrag einen Betriebsreel-Render, der läuft und NICHT
 * stale ist. Stale Zeilen blockieren nicht (die Selbstheilung räumt sie
 * beim nächsten Status-Poll auf).
 */
export function isRenderBusy(
  rows: readonly RenderLockRow[],
  orderId: string,
  now: Date,
): boolean {
  return rows.some(
    (r) =>
      r.order_id !== orderId &&
      r.business_reel_status === "rendering" &&
      !isStaleRendering(r.business_reel_status, r.updated_at, now),
  );
}
