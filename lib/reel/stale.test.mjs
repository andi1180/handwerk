// Tests für lib/reel/stale.ts — reine Funktionen, keine DB.
// Ausführen: `pnpm test` (node --test, Node ≥ 23 mit nativem TS-Type-Stripping).
// Bewusst .mjs: das Projekt hat kein Test-Framework; Node lädt stale.ts direkt.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STALE_RENDER_MS,
  CLIENT_RENDER_TIMEOUT_MS,
  staleCutoff,
  isStaleRendering,
  isRenderBusy,
} from "./stale.ts";

const NOW = new Date("2026-11-15T12:00:00.000Z");
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();

test("Konstanten: 6 min Server, Client-Notbremse liegt darüber", () => {
  assert.equal(STALE_RENDER_MS, 6 * 60 * 1000);
  assert.ok(CLIENT_RENDER_TIMEOUT_MS > STALE_RENDER_MS);
  // maxDuration der Render-Route ist 300 s — Stale-Grenze muss darüber liegen.
  assert.ok(STALE_RENDER_MS > 300 * 1000);
  assert.equal(staleCutoff(NOW).getTime(), NOW.getTime() - STALE_RENDER_MS);
});

test("isStaleRendering: frisches rendering ist nicht stale", () => {
  assert.equal(isStaleRendering("rendering", ago(60_000), NOW), false);
  assert.equal(isStaleRendering("rendering", NOW.toISOString(), NOW), false);
});

test("isStaleRendering: genau am Limit noch NICHT stale (strikt <)", () => {
  assert.equal(isStaleRendering("rendering", ago(STALE_RENDER_MS), NOW), false);
});

test("isStaleRendering: 1 ms über dem Limit ist stale", () => {
  assert.equal(
    isStaleRendering("rendering", ago(STALE_RENDER_MS + 1), NOW),
    true,
  );
  // Der Fall vom 24.09. (Wochen alt).
  assert.equal(
    isStaleRendering("rendering", "2026-09-24T08:00:00+00:00", NOW),
    true,
  );
});

test("isStaleRendering: PostgREST-Zeitstempel mit Mikrosekunden", () => {
  assert.equal(
    isStaleRendering("rendering", "2026-11-15T11:40:00.123456+00:00", NOW),
    true,
  );
  assert.equal(
    isStaleRendering("rendering", "2026-11-15T11:59:00.123456+00:00", NOW),
    false,
  );
});

test("isStaleRendering: Date-Objekt wird akzeptiert", () => {
  assert.equal(
    isStaleRendering("rendering", new Date(NOW.getTime() - STALE_RENDER_MS - 1), NOW),
    true,
  );
});

test("isStaleRendering: null/undefined/unlesbares updatedAt heilt nicht", () => {
  assert.equal(isStaleRendering("rendering", null, NOW), false);
  assert.equal(isStaleRendering("rendering", undefined, NOW), false);
  assert.equal(isStaleRendering("rendering", "kein-datum", NOW), false);
});

test("isStaleRendering: andere Status sind nie stale (Self-Heal greift nur bei rendering)", () => {
  const old = ago(STALE_RENDER_MS * 100);
  for (const s of ["pending", "ready", "failed", "purged", null, undefined, ""]) {
    assert.equal(isStaleRendering(s, old, NOW), false, `status=${s}`);
  }
});

test("isRenderBusy: anderer Auftrag rendert frisch ⇒ busy (409)", () => {
  const rows = [
    { order_id: "B", business_reel_status: "rendering", updated_at: ago(30_000) },
  ];
  assert.equal(isRenderBusy(rows, "A", NOW), true);
});

test("isRenderBusy: nur stale Zeilen ⇒ nicht busy", () => {
  const rows = [
    { order_id: "B", business_reel_status: "rendering", updated_at: ago(STALE_RENDER_MS + 1) },
    { order_id: "C", business_reel_status: "rendering", updated_at: "2026-09-24T08:00:00+00:00" },
  ];
  assert.equal(isRenderBusy(rows, "A", NOW), false);
});

test("isRenderBusy: eigener Auftrag blockiert sich nicht", () => {
  const rows = [
    { order_id: "A", business_reel_status: "rendering", updated_at: ago(10_000) },
  ];
  assert.equal(isRenderBusy(rows, "A", NOW), false);
});

test("isRenderBusy: nicht-rendering Zeilen blockieren nicht", () => {
  const rows = [
    { order_id: "B", business_reel_status: "ready", updated_at: ago(10_000) },
    { order_id: "C", business_reel_status: "failed", updated_at: ago(10_000) },
    { order_id: "D", business_reel_status: "pending", updated_at: ago(10_000) },
  ];
  assert.equal(isRenderBusy(rows, "A", NOW), false);
});

test("isRenderBusy: Mischung aus stale und frisch ⇒ busy", () => {
  const rows = [
    { order_id: "B", business_reel_status: "rendering", updated_at: ago(STALE_RENDER_MS * 10) },
    { order_id: "C", business_reel_status: "rendering", updated_at: ago(STALE_RENDER_MS) },
  ];
  assert.equal(isRenderBusy(rows, "A", NOW), true);
});

test("isRenderBusy: leere Liste ⇒ nicht busy", () => {
  assert.equal(isRenderBusy([], "A", NOW), false);
});
