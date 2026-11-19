import test from "node:test";
import assert from "node:assert/strict";
import { runEightAgentQuantDesk } from "./quant-desk.js";

test("desk has seven specialist roles plus a non-authorizing chief", () => {
  const result = runEightAgentQuantDesk({ market: "BTCUSD", candidate: "BUY",
    weightedScore: { score: 72, coverage: 90 }, quoteValidation: { valid: true },
    spreadVerified: true, plan: { entryTriggerConfirmed: true, entry: 65000, stopLoss: 64000, takeProfit: 67000 } });
  assert.equal(result.roles.length, 7);
  assert.equal(result.chief.specialistCount, 7);
  assert.equal(result.chief.approvalAuthority, false);
  assert.equal(result.safety.signalWeight, 0);
  assert.equal(result.safety.canPlaceOrders, false);
});

test("missing quote, stale data and macro risk are visible blockers", () => {
  const result = runEightAgentQuantDesk({ market: "EURUSD", candidate: "SELL",
    quoteValidation: { valid: false }, staleTimeframes: ["M5"], macroBlocked: true });
  const statuses = Object.fromEntries(result.roles.map(item => [item.name, item.status]));
  assert.equal(statuses.AUDITOR, "BLOCKED");
  assert.equal(statuses.WARDEN, "RISK_WARNING");
  assert.equal(statuses.TRIGGER, "WAITING_FOR_M5");
  assert.equal(result.safety.signalWeight, 0);
});

test("unverified order flow and sentiment are not fabricated", () => {
  const result = runEightAgentQuantDesk({ market: "XAUUSD", candidate: "NO SETUP" });
  const tracker = result.roles.find(item => item.name === "TRACKER");
  const pulse = result.roles.find(item => item.name === "PULSE");
  assert.equal(tracker.status, "NO_VERIFIED_FLOW_FEED");
  assert.equal(pulse.evidence.sentiment, "NOT_COMPUTED");
  assert.equal(pulse.evidence.mentionVelocity, null);
});
