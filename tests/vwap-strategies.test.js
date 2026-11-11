import test from "node:test";
import assert from "node:assert/strict";
import { calculateSessionVWAP, evaluateVWAPStrategies } from "../src/vwap-strategies.js";

const base = Date.UTC(2026, 10, 11, 8, 0);
function candle(i, close, volume = 100) {
  return { timestamp: base + i * 300000, open: close - 0.1, high: close + 0.2, low: close - 0.2, close, volume };
}

test("session VWAP is volume weighted and anchored to UTC day", () => {
  const data = [candle(0, 10, 1), candle(1, 20, 3)];
  const v = calculateSessionVWAP(data);
  assert.equal(v.available, true);
  assert.ok(Math.abs(v.vwap - 17.5) < 1e-9);
  assert.equal(v.anchor, "UTC_DAY");
});

test("VWAP resets on UTC date boundary", () => {
  const data = [candle(0, 10), { ...candle(1, 20), timestamp: Date.UTC(2026, 10, 12, 0, 0) }];
  const v = calculateSessionVWAP(data);
  assert.equal(v.sessionDate, "2026-11-12");
  assert.equal(v.vwap, 20);
});

test("zero volume is unavailable, never replaced with fabricated volume", () => {
  const v = calculateSessionVWAP([candle(0, 10, 0)]);
  assert.equal(v.available, false);
});

test("five strategies always return a structured advisory report", () => {
  const data = Array.from({ length: 30 }, (_, i) => candle(i, 100 + i * 0.01));
  const frame = { close: 100.29, vwap: 100.2, atr14: 0.1, adx14: 22, regime: "BULL_TREND",
    ema50: 100, structure: {}, sessionContext: {} };
  const report = evaluateVWAPStrategies({ candles: data, M5: frame, M15: frame, H1: frame, market: "EURUSD" });
  assert.equal(report.strategies.length, 5);
  assert.equal(report.volumeType, "BROKER_TICK_VOLUME_PROXY");
  assert.ok(report.strategies.every(s => ["BUY", "SELL", "HOLD"].includes(s.signal)));
});
