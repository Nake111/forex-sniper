import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAlphaPipResearch } from "../src/alpha-pip-research.js";

function candles(direction = 1, count = 40) {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + direction * i * 0.2;
    return { timestamp: i * 300_000, open: close - direction * 0.05,
      high: close + 0.3, low: close - 0.3, close, volume: 100 };
  });
}

test("requires ATR expansion, aligned trend and multi-period momentum", () => {
  const result = evaluateAlphaPipResearch(candles(), {
    atr14: 1.2, atrBaseline: 1, ema20: 106.5, ema50: 105
  });
  assert.equal(result.status, "ALIGNED_MOMENTUM_CANDIDATE");
  assert.equal(result.direction, "BULLISH");
  assert.equal(result.alignedMomentum, 3);
  assert.equal(result.researchOnly, true);
  assert.equal(result.voteWeight, 0);
  assert.equal(result.canApproveSignal, false);
});

test("recognizes bearish momentum only with bearish structure", () => {
  const result = evaluateAlphaPipResearch(candles(-1), {
    atr14: 1.2, atrBaseline: 1, ema20: 94, ema50: 95
  });
  assert.equal(result.direction, "BEARISH");
  assert.equal(result.trend, "BEARISH");
});

test("suppresses candidate when volatility has not expanded", () => {
  const result = evaluateAlphaPipResearch(candles(), {
    atr14: 0.9, atrBaseline: 1, ema20: 106.5, ema50: 105
  });
  assert.equal(result.status, "LOW_VOLATILITY_WATCH");
  assert.equal(result.direction, "NONE");
});

test("suppresses candidate when momentum conflicts with trend", () => {
  const result = evaluateAlphaPipResearch(candles(-1), {
    atr14: 1.2, atrBaseline: 1, ema20: 94, ema50: 93
  });
  assert.equal(result.status, "MOMENTUM_NOT_ALIGNED");
  assert.equal(result.direction, "NONE");
});

test("returns unavailable when history or ATR baseline is missing", () => {
  assert.equal(evaluateAlphaPipResearch(candles().slice(0, 10), {
    atr14: 1, atrBaseline: 1, ema20: 102, ema50: 101
  }).status, "UNAVAILABLE");
  assert.equal(evaluateAlphaPipResearch(candles(), {
    atr14: 1, atrBaseline: null, ema20: 107, ema50: 106
  }).status, "UNAVAILABLE");
});
