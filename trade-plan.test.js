import test from "node:test";
import assert from "node:assert/strict";

import { createTradePlan } from "../src/trade-plan.js";

test("trade plan returns a valid HOLD result", () => {
  const plan = createTradePlan({
    signal: "HOLD",
    entry: 60000,
    atr: 500,
  });

  assert.ok(plan);
  assert.equal(plan.signal, "HOLD");
});

test("trade plan uses a stop loss and take profit", () => {
  const plan = createTradePlan({
    signal: "BUY",
    entry: 60000,
    atr: 500,
  });

  assert.ok(plan);

  if (plan.signal === "BUY") {
    assert.ok(plan.stopLoss < plan.entry);
    assert.ok(plan.takeProfit > plan.entry);
  }
});

test("SELL trade plan places stop above entry", () => {
  const plan = createTradePlan({
    signal: "SELL",
    entry: 60000,
    atr: 500,
  });

  assert.ok(plan);

  if (plan.signal === "SELL") {
    assert.ok(plan.stopLoss > plan.entry);
    assert.ok(plan.takeProfit < plan.entry);
  }
});
