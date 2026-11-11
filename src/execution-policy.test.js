import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDeterministicFallback, MARKET_EXECUTION_PROFILES } from "./execution-policy.js";
import { buildIndicativeTradePlan } from "./trade-plan.js";

function alignedFrames(market = "EURUSD") {
  const m5 = {
    close: 1.1, atr14: 0.001, atrBaseline: 0.001, adx14: 22,
    regime: "BULL_TREND", macdHistogram: 0.0001, rsi14: 58,
    supertrend: { direction: "BULLISH" }, cci20: 75, roc: { direction: "BULLISH" },
    lastCandle: { open: 1.099, high: 1.101, low: 1.0988, close: 1.1 },
    structure: { swingLow: 1.097 }, smartMoney: { orderBlocks: [] }
  };
  const other = { regime: "BULL_TREND", macdHistogram: 0.0001, close: 1.1 };
  return { M5: m5, M15: { ...other, rsi14: 58 }, H1: { ...other } };
}

test("all three instruments have distinct calibration profiles", () => {
  assert.notDeepEqual(MARKET_EXECUTION_PROFILES.EURUSD, MARKET_EXECUTION_PROFILES.BTCUSD);
  assert.notDeepEqual(MARKET_EXECUTION_PROFILES.BTCUSD, MARKET_EXECUTION_PROFILES.XAUUSD);
  assert.ok(MARKET_EXECUTION_PROFILES.BTCUSD.maxAtrExpansion > MARKET_EXECUTION_PROFILES.EURUSD.maxAtrExpansion);
});

test("deterministic fallback approves aligned closed-candle evidence without Gemini", () => {
  for (const market of ["EURUSD", "BTCUSD", "XAUUSD"]) {
    const result = evaluateDeterministicFallback("BUY", market, alignedFrames(market), { eventRisk: "NORMAL" });
    assert.equal(result.approved, true, market + ": " + result.reason);
  }
});

test("hard market risk blocks fallback and exposes exact reasons", () => {
  const result = evaluateDeterministicFallback("BUY", "EURUSD", alignedFrames(), {
    eventRisk: "HIGH", dataStale: true
  });
  assert.equal(result.approved, false);
  assert.ok(result.blockers.some(reason => reason.includes("Economic/news risk")));
  assert.ok(result.blockers.some(reason => reason.includes("Stale candle data")));
});

test("indicative entry, stop and target are generated without execution approval", () => {
  const frames = alignedFrames();
  const plan = buildIndicativeTradePlan("BUY", frames.M5, "EURUSD");
  assert.ok(plan);
  assert.equal(plan.executable, false);
  assert.equal(plan.entry, 1.1);
  assert.ok(plan.stopLoss < plan.entry);
  assert.ok(plan.takeProfit > plan.entry);
  assert.equal(plan.riskReward, "1:2.0");
});

test("indicative plan survives an unconfirmed trigger and labels it", () => {
  const frames = alignedFrames();
  frames.M5.lastCandle = { open: 1.1, high: 1.101, low: 1.098, close: 1.099 };
  const plan = buildIndicativeTradePlan("BUY", frames.M5, "EURUSD");
  assert.ok(plan);
  assert.equal(plan.entryTriggerConfirmed, false);
  assert.match(plan.status, /INDICATIVE/);
});
