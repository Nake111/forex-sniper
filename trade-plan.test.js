import test from "node:test";
import assert from "node:assert/strict";

import { tradePlan, finalAction } from "./src/trade-plan.js";

test("HOLD signal does not create a trade plan", () => {
  const plan = tradePlan("HOLD", {
    close: 60000,
    atr14: 500
  }, { status: "H1 ALIGNED" });

  assert.equal(plan, null);
  assert.equal(finalAction("HOLD", plan), "NO TRADE");
});

test("BUY plan has correct stop loss and take profit", () => {
  const plan = tradePlan("BUY", {
    close: 60000,
    atr14: 500
  }, { status: "H1 ALIGNED" });

  assert.ok(plan);
  assert.equal(plan.entry, 60000);
  assert.equal(plan.stopLoss, 59250);
  assert.equal(plan.takeProfit, 61500);
  assert.equal(plan.riskReward, "1:2");
  assert.equal(finalAction("BUY", plan), "BUY");
});

test("SELL plan has correct stop loss and take profit", () => {
  const plan = tradePlan("SELL", {
    close: 60000,
    atr14: 500
  }, { status: "H1 ALIGNED" });

  assert.ok(plan);
  assert.equal(plan.entry, 60000);
  assert.equal(plan.stopLoss, 60750);
  assert.equal(plan.takeProfit, 58500);
  assert.equal(plan.riskReward, "1:2");
  assert.equal(finalAction("SELL", plan), "SELL");
});

test("No trade plan without H1 confirmation", () => {
  const plan = tradePlan("BUY", {
    close: 60000,
    atr14: 500
  }, { status: "WAIT" });

  assert.equal(plan, null);
});

test("No trade plan with invalid ATR", () => {
  const plan = tradePlan("BUY", {
    close: 60000,
    atr14: 0
  }, { status: "H1 ALIGNED" });

  assert.equal(plan, null);
});
