// Tests für lib/reel/limits.ts — reine Funktionen, keine DB.
// Ausführen: `pnpm test` (node --test, Node ≥ 23 mit nativem TS-Type-Stripping).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUSINESS_REEL_MAX_BYTES, exceedsBusinessReelMaxBytes } from "./limits.ts";

test("Grenze liegt unter 50 MB in beiden Lesarten (10⁶ und 2²⁰)", () => {
  assert.equal(BUSINESS_REEL_MAX_BYTES, 48_000_000);
  assert.ok(BUSINESS_REEL_MAX_BYTES < 50 * 1000 * 1000);
  assert.ok(BUSINESS_REEL_MAX_BYTES < 50 * 1024 * 1024);
});

test("genau an der Grenze ist erlaubt, ein Byte darüber nicht", () => {
  assert.equal(exceedsBusinessReelMaxBytes(BUSINESS_REEL_MAX_BYTES), false);
  assert.equal(exceedsBusinessReelMaxBytes(BUSINESS_REEL_MAX_BYTES + 1), true);
});

test("typische Reels sind erlaubt", () => {
  assert.equal(exceedsBusinessReelMaxBytes(1_600_000), false);
  assert.equal(exceedsBusinessReelMaxBytes(19_900_000), false);
});

test("unbekannte Größe blockiert nicht", () => {
  assert.equal(exceedsBusinessReelMaxBytes(null), false);
});
