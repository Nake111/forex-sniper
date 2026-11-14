import test from "node:test";
import assert from "node:assert/strict";
import {
  stochasticOscillator,
  candleStreakReversal,
  rsiWickConfirmation
} from "../src/market.js";

test("classic stochastic uses closed OHLC candles and reports directional alignment", () => {
  const candles = Array.from({ length: 20 }, (_, i) => ({
    open: 100 + i,
    high: 102 + i,
    low: 99 + i,
    close: 101 + i
  }));
  const result = stochasticOscillator(candles, 14, 3);
  assert.ok(Number.isFinite(result.k));
  assert.ok(Number.isFinite(result.d));
  assert.equal(result.direction, "BULLISH");
});

test("candle streak requires three prior same-color candles and a strong reversal close", () => {
  const candles = [
    { open: 104, high: 105, low: 102, close: 103 },
    { open: 103, high: 104, low: 101, close: 102 },
    { open: 102, high: 103, low: 100, close: 101 },
    { open: 101, high: 102, low: 99, close: 100 },
    { open: 99, high: 103, low: 98, close: 102.5 }
  ];
  const result = candleStreakReversal(candles, 3);
  assert.equal(result.direction, "BULLISH");
  assert.equal(result.streak, 4);
  assert.equal(result.confirmed, true);
});

test("RSI wick confirmation requires overbought/oversold RSI and a 30% rejection wick", () => {
  const bullish = rsiWickConfirmation({ open: 101, high: 102, low: 98, close: 101.5 }, 28, 30);
  const bearish = rsiWickConfirmation({ open: 101, high: 105, low: 100, close: 101.2 }, 73, 30);
  const noSignal = rsiWickConfirmation({ open: 100, high: 101, low: 99, close: 100.5 }, 45, 30);
  assert.equal(bullish.direction, "BULLISH");
  assert.equal(bearish.direction, "BEARISH");
  assert.equal(noSignal.confirmed, false);
});

test("stochastic safely reports unavailable with insufficient candles", () => {
  const result = stochasticOscillator([{ open: 1, high: 2, low: 0, close: 1 }], 14, 3);
  assert.equal(result.direction, "UNAVAILABLE");
});
