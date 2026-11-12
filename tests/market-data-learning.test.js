import test from "node:test";
import assert from "node:assert/strict";
import { learnFromMarketData } from "../src/market-data-learning.js";

function makeCandles(count = 500) {
  let close = 100;
  return Array.from({ length: count }, (_, index) => {
    close *= 1 + (index % 90 < 45 ? 0.0008 : -0.0005) + Math.sin(index / 5) * 0.00015;
    return {
      timestamp: Date.UTC(2025, 0, 1) + index * 300_000,
      open: close * 0.9998,
      high: close * 1.001,
      low: close * 0.999,
      close,
      volume: 100 + index
    };
  });
}

test("market learner trains from OHLCV candles and reserves the final 30 percent", () => {
  const result = learnFromMarketData(makeCandles(), { market: "EURUSD" });
  assert.equal(result.market, "EURUSD");
  assert.equal(result.trainingSource, "ONLINE_MARKET_CANDLES_ONLY");
  assert.equal(result.trainingBars, 350);
  assert.equal(result.reservedBars, 150);
  assert.equal(result.paperOutcomesUsed, false);
  assert.ok(result.observations > 30);
  assert.ok(Array.isArray(result.profiles));
});

test("market learner does not claim a model when candle history is too short", () => {
  const result = learnFromMarketData(makeCandles(80));
  assert.equal(result.status, "INSUFFICIENT_DATA");
});

test("market learner rejects malformed candle history", () => {
  const result = learnFromMarketData([{ open: 1, high: 0.9, low: 0.8, close: 1 }]);
  assert.equal(result.status, "INSUFFICIENT_DATA");
});

test("market learner rejects an invalid training split", () => {
  assert.throws(() => learnFromMarketData(makeCandles(), { trainingRatio: 0.4 }), /Invalid market-data learning configuration/);
});
