import test from "node:test";
import assert from "node:assert/strict";
import { findHistoricalCoverageGap } from "./candle-history-coverage.js";

const day = 86_400_000;

test("detects Twelve Data 5000-candle history truncation", () => {
  const cutoff = 1_000_000_000;
  const candles = [{ timestamp: cutoff + 20 * day }, { timestamp: cutoff + 21 * day }];
  const gap = findHistoricalCoverageGap(candles, cutoff);
  assert.equal(gap.reason, "INCOMPLETE_HISTORY");
  assert.equal(gap.from, cutoff);
  assert.equal(gap.to, cutoff + 20 * day - 1);
});

test("accepts weekend-sized gaps at the beginning of a requested history window", () => {
  const cutoff = 1_000_000_000;
  assert.equal(findHistoricalCoverageGap([{ timestamp: cutoff + 2 * day }], cutoff), null);
});

test("requests a full historical backfill when no candles are available", () => {
  const gap = findHistoricalCoverageGap([], 12345);
  assert.deepEqual(gap, { from: 12345, to: null, reason: "NO_CANDLES" });
});
