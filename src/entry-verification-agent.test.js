import test from "node:test";
import assert from "node:assert/strict";
import { runEntryVerificationAgent } from "./entry-verification-agent.js";

const base = {
  market: "EURUSD",
  candidate: "BUY",
  plan: { direction: "BUY", entry: 1.10000, stopLoss: 1.09900, takeProfit: 1.10210, entryTriggerConfirmed: true },
  quote: { bid: 1.10000, ask: 1.10002, source: "test", venue: "reference" },
  quoteValidation: { valid: true, ageMs: 100, spread: 0.00002 },
  entryAtr: 0.001,
  marketReview: { approved: true, direction: "BUY" },
  approval: { approved: true, decision: "BUY" },
  dataStale: false,
  now: 1_800_000_000_000
};

test("verifies an aligned BUY against live ask, spread, SL/TP and effective 1:2 reward/risk", () => {
  const result = runEntryVerificationAgent(base);
  assert.equal(result.approved, true);
  assert.equal(result.executablePrice, base.quote.ask);
  assert.equal(result.effectiveRiskReward >= 2, true);
});

test("rejects when live ask moved too far from planned entry", () => {
  const result = runEntryVerificationAgent({ ...base, quote: { ...base.quote, ask: 1.1005, bid: 1.10048 } });
  assert.equal(result.approved, false);
  assert.ok(result.blockers.some(x => x.includes("ATR from planned entry")));
});

test("rejects a spread wider than market-specific ATR limit", () => {
  const result = runEntryVerificationAgent({ ...base, quote: { ...base.quote, ask: 1.1002, bid: 1.1 } });
  assert.equal(result.approved, false);
  assert.ok(result.blockers.some(x => x.includes("Spread/ATR")));
});

test("rejects missing or stale quote and an unconfirmed candle trigger", () => {
  const result = runEntryVerificationAgent({
    ...base, quoteValidation: { valid: false, reason: "Quote is stale" },
    plan: { ...base.plan, entryTriggerConfirmed: false }
  });
  assert.equal(result.approved, false);
  assert.ok(result.blockers.some(x => x.includes("stale")));
  assert.ok(result.blockers.some(x => x.includes("M5 entry trigger")));
});

test("rejects invalid live-side stop/target geometry and insufficient effective reward/risk", () => {
  const result = runEntryVerificationAgent({
    ...base, plan: { ...base.plan, stopLoss: 1.10001, takeProfit: 1.10003 }
  });
  assert.equal(result.approved, false);
  assert.ok(result.blockers.some(x => x.includes("correct sides")));
  assert.ok(result.blockers.some(x => x.includes("below 1:2")));
});

test("rejects when either independent upstream agent disagrees", () => {
  const result = runEntryVerificationAgent({
    ...base, marketReview: { approved: false, direction: "SELL" }
  });
  assert.equal(result.approved, false);
  assert.ok(result.blockers.some(x => x.includes("market-intelligence")));
  assert.ok(result.blockers.some(x => x.includes("signal approval")));
});

test("uses BTC-specific spread and entry deviation limits", () => {
  const result = runEntryVerificationAgent({
    ...base, market: "BTCUSD", candidate: "BUY",
    plan: { direction: "BUY", entry: 100, stopLoss: 98, takeProfit: 105, entryTriggerConfirmed: true },
    quote: { bid: 100, ask: 100.1 }, quoteValidation: { valid: true, ageMs: 100 },
    entryAtr: 1
  });
  assert.equal(result.approved, true);
});
