
import test from "node:test";
import assert from "node:assert/strict";
import { finalAction, tradePlan } from "./src/trade-plan.js";

const market = {
  close: 1.12390,
  atr14: 0.000374
};

test("BUY with H1 WAIT means NO TRADE", () => {
  const plan = tradePlan("BUY", market, { status: "WAIT" });
  assert.equal(plan, null);
  assert.equal(finalAction("BUY", plan), "NO TRADE");
});

test("SELL with H1 WAIT means NO TRADE", () => {
  const plan = tradePlan("SELL", market, { status: "WAIT" });
  assert.equal(plan, null);
  assert.equal(finalAction("SELL", plan), "NO TRADE");
});

test("BUY with H1 ALIGNED creates a valid plan", () => {
  const plan = tradePlan("BUY", market, { status: "H1 ALIGNED" });
  assert.ok(plan);
  assert.ok(plan.stopLoss < plan.entry);
  assert.ok(plan.takeProfit > plan.entry);
  assert.equal(plan.riskReward, "1:2");
});

test("SELL with H1 ALIGNED creates a valid plan", () => {
  const plan = tradePlan("SELL", market, { status: "H1 ALIGNED" });
  assert.ok(plan);
  assert.ok(plan.stopLoss > plan.entry);
  assert.ok(plan.takeProfit < plan.entry);
  assert.equal(plan.riskReward, "1:2");
});

test("HOLD never creates a trade plan", () => {
  assert.equal(
    tradePlan("HOLD", market, { status: "H1 ALIGNED" }),
    null
  );
});

test("Invalid ATR or missing confirmation blocks a plan", () => {
  assert.equal(
    tradePlan("BUY", { ...market, atr14: 0 }, { status: "H1 ALIGNED" }),
    null
  );
  assert.equal(
    tradePlan("BUY", market, null),
    null
  );
});
