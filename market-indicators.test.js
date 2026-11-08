import test from "node:test";
import assert from "node:assert/strict";
import { stochasticRsi, parabolicSar, donchianChannels, onBalanceVolume } from "./src/market.js";

function trendCandles(count, direction = 1) {
  return Array.from({ length: count }, (_, i) => {
    const close = 2000 + direction * i * 0.8 + Math.sin(i / 3) * 0.15;
    return { timestamp: i * 60_000, open: close - direction * 0.2, high: close + 0.5, low: close - 0.5, close, volume: 100 + i };
  });
}

test("Stochastic RSI returns bounded K/D values", () => {
  const result = stochasticRsi(trendCandles(100).map(c => c.close));
  assert.ok(Number.isFinite(result.k));
  assert.ok(Number.isFinite(result.d));
  assert.ok(result.k >= 0 && result.k <= 100);
  assert.ok(result.d >= 0 && result.d <= 100);
});

test("Parabolic SAR returns a finite value and direction", () => {
  const result = parabolicSar(trendCandles(80));
  assert.ok(Number.isFinite(result.value));
  assert.ok(["BULLISH", "BEARISH"].includes(result.direction));
});

test("Donchian breakout uses prior candles, excluding the current bar", () => {
  const candles = trendCandles(30, 1);
  const previousHigh = Math.max(...candles.slice(-21, -1).map(c => c.high));
  candles[candles.length - 1].close = previousHigh + 2;
  candles[candles.length - 1].high = previousHigh + 2.5;
  const result = donchianChannels(candles, 20);
  assert.equal(result.breakout, "BULLISH");
  assert.equal(result.upper, previousHigh);
});

test("OBV responds to rising and falling closes", () => {
  const up = onBalanceVolume(trendCandles(30, 1));
  const down = onBalanceVolume(trendCandles(30, -1));
  assert.equal(up.direction, "BUYING");
  assert.equal(down.direction, "SELLING");
  assert.ok(Number.isFinite(up.slope));
  assert.ok(Number.isFinite(down.slope));
});
