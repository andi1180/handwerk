// Tests für lib/reel/diag.ts (node --test, Node ≥ 23 mit nativem TS-Type-Stripping).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startReelMemDiag,
  shortError,
  fileBytes,
  readCgroupMb,
} from "./diag.ts";

/** console.log abfangen, fn ausführen, geloggte Zeilen zurückgeben. */
function captureLogs(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines;
}

test("start/log/finish: je GENAU eine JSON-Zeile mit den Pflichtfeldern", () => {
  const lines = captureLogs(() => {
    const diag = startReelMemDiag({ kind: "business", orderId: "o1", businessId: "b1" });
    diag.log("downloaded", { photos: 2, videos: 1, input_bytes: 123 });
    diag.finish("done");
  });
  assert.equal(lines.length, 3);
  const rows = lines.map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => r.stage), ["start", "downloaded", "done"]);
  for (const r of rows) {
    assert.equal(r.evt, "reel_mem");
    assert.equal(r.kind, "business");
    assert.equal(r.orderId, "o1");
    assert.equal(r.businessId, "b1");
    for (const k of ["t_ms", "rss_mb", "heap_used_mb", "external_mb", "array_buffers_mb"]) {
      assert.equal(typeof r[k], "number", k);
    }
    assert.ok(r.cgroup_mb === null || typeof r.cgroup_mb === "number");
  }
  assert.equal(rows[1].photos, 2);
  assert.equal(typeof rows[2].peak_rss_mb, "number");
  assert.ok(rows[2].peak_rss_mb > 0);
  assert.equal(typeof rows[2].total_ms, "number");
  assert.ok("peak_cgroup_mb" in rows[2]);
});

test("finish ist idempotent, log nach finish schreibt nichts", () => {
  const lines = captureLogs(() => {
    const diag = startReelMemDiag({ kind: "business", orderId: "o", businessId: "b" });
    diag.finish("failed", { error: "x" });
    diag.finish("done");
    diag.log("late");
  });
  assert.equal(lines.length, 2);
  const last = JSON.parse(lines[1]);
  assert.equal(last.stage, "failed");
  assert.equal(last.error, "x");
});

test("Logging-Störung wirft nie (console.log kaputt)", () => {
  const original = console.log;
  console.log = () => {
    throw new Error("boom");
  };
  try {
    assert.doesNotThrow(() => {
      const diag = startReelMemDiag({ kind: "business", orderId: "o", businessId: "b" });
      diag.log("segment", { index: 0 });
      diag.finish("done");
    });
  } finally {
    console.log = original;
  }
});

test("shortError kürzt auf 200 Zeichen und macht einzeilig", () => {
  const out = shortError("a\n  b\t" + "x".repeat(500));
  assert.equal(out.length, 200);
  assert.ok(out.startsWith("a b x"));
  assert.ok(!/\s{2,}|\n/.test(out));
});

test("fileBytes: fehlende Datei ⇒ null, vorhandene ⇒ Größe", () => {
  assert.equal(fileBytes("/does/not/exist/reel.mp4"), null);
  assert.ok((fileBytes(new URL(import.meta.url).pathname) ?? 0) > 0);
});

test("readCgroupMb liefert Zahl oder null (lokal ohne cgroup: null)", () => {
  const v = readCgroupMb();
  assert.ok(v === null || (typeof v === "number" && v >= 0));
});
