import test from "node:test";
import assert from "node:assert/strict";
import { classifyMarketRegime, measureDirectionalAccuracy, createChronologicalHoldout, buildAgentForecasts } from "./signal-quality.js";

test("regime classifier distinguishes trend, range, volatility and abnormal", () => {
  const base = { close: 110, ema20: 109, ema50: 108, ema200: 100, adx14: 25, atr14: 1, atrBaseline: 1, candleRange: 1, rangeBaseline: 1 };
  assert.equal(classifyMarketRegime(base), "BULL_TREND");
  assert.equal(classifyMarketRegime({ ...base, adx14: 10 }), "RANGE");
  assert.equal(classifyMarketRegime({ ...base, atr14: 2 }), "HIGH_VOLATILITY");
  assert.equal(classifyMarketRegime({ ...base, candleRange: 5 }), "ABNORMAL");
});

test("BUY and SELL accuracy report false signals independently", () => {
  const m = measureDirectionalAccuracy([
    { predictedSide: "BUY", actualDirection: "BUY" },
    { predictedSide: "BUY", actualDirection: "SELL" },
    { predictedSide: "SELL", actualDirection: "SELL" }
  ]);
  assert.equal(m.BUY.accuracyPct, 50);
  assert.equal(m.BUY.falseSignals, 1);
  assert.equal(m.SELL.accuracyPct, 100);
});

test("holdout digest detects any mutation", () => {
  const split = createChronologicalHoldout([1,2,3,4,5,6,7,8,9,10]);
  assert.equal(split.training.length, 7);
  assert.equal(split.holdout.length, 3);
  assert.equal(split.assertUnchanged([8,9,10]), true);
  assert.throws(() => split.assertUnchanged([8,9,11]), /HOLDOUT_INTEGRITY_VIOLATION/);
});

test("agent forecasts preserve each independent prediction", () => {
  const rows = buildAgentForecasts({ market: "EURUSD", candleAt: 1000, close: 1.1, atr14: 0.001, regime: "RANGE", agents: [{name:"A",signal:"BUY"},{name:"B",signal:"NO_SIGNAL"}] });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].predictedSide, "BUY");
  assert.equal(rows[1].predictedSide, "NO_SIGNAL");
});
