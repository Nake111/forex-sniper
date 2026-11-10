import test from "node:test";
import assert from "node:assert/strict";
import { finalAction, tradePlan } from "./src/trade-plan.js";

const market = { close: 1.12390, atr14: 0.000374, lastCandle: { open: 1.12370, high: 1.12400, low: 1.12360, close: 1.12390 } };
const sellMarket = { ...market, lastCandle: { open: 1.12400, high: 1.12410, low: 1.12370, close: 1.12390 } };

test("BUY with H1 WAIT means NO TRADE", () => {
  const plan = tradePlan("BUY", market, { status: "WAIT" });
  assert.equal(plan, null);
  assert.equal(finalAction("BUY", plan), "NO TRADE");
});
test("SELL with H1 WAIT means NO TRADE", () => {
  assert.equal(tradePlan("SELL", sellMarket, { status: "WAIT" }), null);
});
test("BUY with H1 ALIGNED creates an ATR fallback plan", () => {
  const plan = tradePlan("BUY", market, { status: "H1 ALIGNED" });
  assert.ok(plan);
  assert.ok(plan.stopLoss < plan.entry);
  assert.ok(plan.takeProfit > plan.entry);
  assert.equal(plan.riskReward, "1:2");
  assert.equal(plan.stopType, "ATR_FALLBACK");
});
test("SELL with H1 ALIGNED creates an ATR fallback plan", () => {
  const plan = tradePlan("SELL", sellMarket, { status: "H1 ALIGNED" });
  assert.ok(plan);
  assert.ok(plan.stopLoss > plan.entry);
  assert.ok(plan.takeProfit < plan.entry);
  assert.equal(plan.riskReward, "1:2");
});
test("structure stop uses swing invalidation with ATR buffer", () => {
  const plan = tradePlan("BUY", { ...market, structure: { swingLow: 1.1232, swingLowBarsAgo: 8 } }, { status: "H1 ALIGNED" });
  assert.equal(plan.stopType, "MARKET_STRUCTURE");
  assert.ok(plan.stopLoss < 1.1232);
  assert.ok(plan.riskDistance > market.atr14 * 0.8);
});
test("HOLD never creates a trade plan", () => {
  assert.equal(tradePlan("HOLD", market, { status: "H1 ALIGNED" }), null);
});
test("Missing or directionally invalid M5 entry trigger blocks a plan", () => {
  assert.equal(tradePlan("BUY", { close: market.close, atr14: market.atr14 }, { status: "H1 ALIGNED" }), null);
  assert.equal(tradePlan("BUY", sellMarket, { status: "H1 ALIGNED" }), null);
});

test("Invalid ATR or missing confirmation blocks a plan", () => {
  assert.equal(tradePlan("BUY", { ...market, atr14: 0 }, { status: "H1 ALIGNED" }), null);
  assert.equal(tradePlan("BUY", market, null), null);
});
