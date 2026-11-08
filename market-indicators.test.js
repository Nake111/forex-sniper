import test from "node:test";
import assert from "node:assert/strict";
import { stochasticRsi, parabolicSar, donchianChannels, onBalanceVolume, williamsR, keltnerChannels, aroon, rateOfChange } from "./src/market.js";

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

test("Williams %R remains within -100 to 0", () => {
  const result = williamsR(trendCandles(40), 14);
  assert.ok(Number.isFinite(result.value));
  assert.ok(result.value >= -100 && result.value <= 0);
});

test("Keltner channels are ordered around their EMA basis", () => {
  const result = keltnerChannels(trendCandles(80), 20, 2);
  assert.ok(Number.isFinite(result.middle));
  assert.ok(result.lower < result.middle && result.middle < result.upper);
});

test("Aroon oscillator is bounded and directional", () => {
  const result = aroon(trendCandles(60), 25);
  assert.ok(result.up >= 0 && result.up <= 100);
  assert.ok(result.down >= 0 && result.down <= 100);
  assert.ok(result.oscillator >= -100 && result.oscillator <= 100);
  assert.equal(result.direction, "BULLISH");
});

test("ROC is positive for rising prices and negative for falling prices", () => {
  assert.equal(rateOfChange(trendCandles(40, 1).map(c => c.close)).direction, "BULLISH");
  assert.equal(rateOfChange(trendCandles(40, -1).map(c => c.close)).direction, "BEARISH");
});
