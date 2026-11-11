import test from "node:test";
import assert from "node:assert/strict";
import { discoverSetups } from "../src/setup-discovery.js";

const frame = (regime, extra = {}) => ({ regime, close: 105, ema20: 104, ema50: 100, ...extra });

test("discovers a trend continuation candidate before the M5 trigger forms", () => {
  const result = discoverSetups({
    H4: frame("BULL_TREND"),
    H1: frame("BULL_TREND"),
    M15: frame("BULL_TREND", { rsi14: 56, macdHistogram: 0.2 }),
    M5: frame("RANGE", { lastCandle: { open: 104, high: 106, low: 103, close: 104.5 } })
  });
  assert.equal(result.candidate, "BUY");
  assert.equal(result.status, "CANDIDATE_FOUND");
  assert.match(result.approval, /NOT_APPROVED/);
});

test("does not discover against conflicting higher-timeframe trends", () => {
  const result = discoverSetups({
    H4: frame("BULL_TREND"),
    H1: frame("BEAR_TREND", { close: 95, ema20: 96, ema50: 100 }),
    M15: frame("BULL_TREND"),
    M5: frame("BULL_TREND")
  });
  assert.equal(result.candidate, "HOLD");
});

test("records an M5 structure breakout as candidate evidence without approving it", () => {
  const result = discoverSetups({
    H4: frame("BEAR_TREND", { close: 95, ema20: 96, ema50: 100 }),
    H1: frame("BEAR_TREND", { close: 95, ema20: 96, ema50: 100 }),
    M15: frame("BEAR_TREND", { close: 95, ema20: 96, ema50: 100, rsi14: 42, macdHistogram: -0.2 }),
    M5: frame("RANGE", { structure: { bos: "BEARISH" } })
  });
  assert.equal(result.candidate, "SELL");
  assert.equal(result.best.setupType, "BREAKOUT");
  assert.match(result.approval, /NOT_APPROVED/);
});
