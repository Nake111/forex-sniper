import test from "node:test";
import assert from "node:assert/strict";
import { calculateTradeExcursions } from "./trade-excursions.js";

test("BUY excursions use highs for favourable and lows for adverse movement", () => {
  const result = calculateTradeExcursions({
    side: "BUY", entry: 100, stop: 98,
    candles: [{ high: 103, low: 99 }, { high: 101, low: 96 }]
  });
  assert.equal(result.maxFavorableExcursionR, 1.5);
  assert.equal(result.maxAdverseExcursionR, 2);
  assert.equal(result.excursionBars, 2);
  assert.equal(result.excursionCoverage, true);
});

test("SELL excursions invert favourable and adverse price directions", () => {
  const result = calculateTradeExcursions({
    side: "SELL", entry: 100, stop: 102,
    candles: [{ high: 101, low: 97 }, { high: 104, low: 99 }]
  });
  assert.equal(result.maxFavorableExcursionR, 1.5);
  assert.equal(result.maxAdverseExcursionR, 2);
});

test("invalid risk or missing path fails closed without invented excursion values", () => {
  assert.equal(calculateTradeExcursions({ side: "BUY", entry: 100, stop: 100, candles: [{high:101,low:99}] }).excursionCoverage, false);
  assert.equal(calculateTradeExcursions({ side: "BUY", entry: 100, stop: 98, candles: [] }).maxFavorableExcursionR, null);
});
