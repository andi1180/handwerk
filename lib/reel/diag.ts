import { readFileSync, statSync } from "node:fs";

/**
 * Speicher-Diagnose für Reel-Renders (server-only, KEINE Verhaltensänderung).
 *
 * Zweck: messbar machen, wie viel Speicher ein einzelner Render braucht und in
 * welcher Phase der Peak liegt (Vercel beendet Renders teils hart per OOM/
 * Timeout). Jede Messung ist GENAU EINE `console.log`-Zeile mit JSON:
 *
 *   {"evt":"reel_mem","kind":"business","orderId":…,"businessId":…,
 *    "stage":…,"t_ms":…,"rss_mb":…,"heap_used_mb":…,"external_mb":…,
 *    "array_buffers_mb":…,"cgroup_mb":…, …extra}
 *
 * `cgroup_mb` liest den Speicherverbrauch der ganzen cgroup (v2
 * `memory.current`, sonst v1 `memory.usage_in_bytes`, sonst `null`) — das
 * erfasst auch den ffmpeg-KINDPROZESS, den `process.memoryUsage()` nicht sieht.
 *
 * Ein Peak-Sampler liest während des gesamten Renders alle 1000 ms `cgroup_mb`
 * und `rss_mb` und merkt sich die Maxima; `finish()` schreibt sie in die
 * Abschlusszeile (`stage = 'done' | 'failed'`).
 *
 * HARTE REGELN:
 *  - Alles in try/catch — eine Logging-Störung darf den Render NIE beeinflussen
 *    (keine Methode wirft, kein Rückgabewert wird vom Render ausgewertet).
 *  - KEINE personenbezogenen Daten: nur orderId, businessId und Zahlen; keine
 *    Kundennamen, keine Captions, keine Dateipfade. `extra` nimmt deshalb nur
 *    Zahlen, Booleans und kurze feste Kennungen (z. B. Medientyp) auf.
 */

export type ReelKind = "business" | "customer";
export type ReelMemExtra = Record<string, number | string | boolean | null>;

const SAMPLE_INTERVAL_MS = 1000;
const ERROR_MAX_CHARS = 200;
const CGROUP_V2 = "/sys/fs/cgroup/memory.current";
const CGROUP_V1 = "/sys/fs/cgroup/memory/memory.usage_in_bytes";

/** Bytes → MB, eine Nachkommastelle. */
function toMb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

/**
 * cgroup-Speicher in MB oder `null`. Synchroner Mini-Read (eine Zeile) — die
 * Datei ist ein Kernel-Pseudofile, kein echtes I/O. v2 zuerst, dann v1.
 */
export function readCgroupMb(): number | null {
  for (const file of [CGROUP_V2, CGROUP_V1]) {
    try {
      const n = Number.parseInt(readFileSync(file, "utf8").trim(), 10);
      if (Number.isFinite(n) && n >= 0) return toMb(n);
    } catch {
      // Datei fehlt / nicht lesbar ⇒ nächste Variante.
    }
  }
  return null;
}

/** Dateigröße in Bytes oder `null` — wirft nie. */
export function fileBytes(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

/** Fehlertext für die Abschlusszeile: einzeilig, auf 200 Zeichen gekürzt. */
export function shortError(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, ERROR_MAX_CHARS);
}

export type ReelMemDiag = {
  /** Eine `reel_mem`-Zeile für eine Zwischenphase. */
  log: (stage: string, extra?: ReelMemExtra) => void;
  /**
   * Sampler stoppen + Abschlusszeile (`done`/`failed`) mit Peaks und
   * `total_ms`. Idempotent — ein zweiter Aufruf tut nichts.
   */
  finish: (outcome: "done" | "failed", extra?: ReelMemExtra) => void;
};

/**
 * Startet die Messung für einen Render: schreibt sofort `stage='start'` und
 * startet den Peak-Sampler (`setInterval(...).unref()` ⇒ hält den Prozess
 * nicht am Leben). Der Aufrufer MUSS `finish()` im `finally` aufrufen.
 */
export function startReelMemDiag(ctx: {
  kind: ReelKind;
  orderId: string;
  businessId: string;
}): ReelMemDiag {
  const startedAt = Date.now();
  let peakCgroupMb: number | null = null;
  let peakRssMb = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let finished = false;

  const sample = (): { rss: number; cgroup: number | null } => {
    const rss = toMb(process.memoryUsage.rss());
    const cgroup = readCgroupMb();
    if (rss > peakRssMb) peakRssMb = rss;
    if (cgroup !== null && (peakCgroupMb === null || cgroup > peakCgroupMb)) {
      peakCgroupMb = cgroup;
    }
    return { rss, cgroup };
  };

  const write = (stage: string, extra?: ReelMemExtra): void => {
    try {
      const mem = process.memoryUsage();
      const { cgroup } = sample();
      console.log(
        JSON.stringify({
          evt: "reel_mem",
          kind: ctx.kind,
          orderId: ctx.orderId,
          businessId: ctx.businessId,
          stage,
          t_ms: Date.now() - startedAt,
          rss_mb: toMb(mem.rss),
          heap_used_mb: toMb(mem.heapUsed),
          external_mb: toMb(mem.external),
          array_buffers_mb: toMb(mem.arrayBuffers),
          cgroup_mb: cgroup,
          ...extra,
        }),
      );
    } catch {
      // Logging darf den Render nie stören.
    }
  };

  try {
    timer = setInterval(() => {
      try {
        sample();
      } catch {
        /* ignorieren */
      }
    }, SAMPLE_INTERVAL_MS);
    timer.unref?.();
  } catch {
    timer = null;
  }

  write("start");

  return {
    log: (stage, extra) => {
      if (!finished) write(stage, extra);
    },
    finish: (outcome, extra) => {
      if (finished) return;
      finished = true;
      try {
        if (timer) clearInterval(timer);
      } catch {
        /* ignorieren */
      }
      timer = null;
      // Letzte Messung VOR dem Peak-Snapshot, damit sie in die Maxima eingeht.
      try {
        sample();
      } catch {
        /* ignorieren */
      }
      write(outcome, {
        ...extra,
        peak_cgroup_mb: peakCgroupMb,
        peak_rss_mb: peakRssMb,
        total_ms: Date.now() - startedAt,
      });
    },
  };
}
