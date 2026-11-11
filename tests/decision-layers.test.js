import test from "node:test";
import assert from "node:assert/strict";
import { buildDiscoveryLayer, buildVerificationLayer, buildExecutionLayer } from "../src/decision-layers.js";

const frames = {
  M5: { close: 101, ema20: 101, ema50: 100 },
  M15: { close: 102, ema20: 102, ema50: 100 },
  H1: { close: 103, ema20: 102, ema50: 100 },
  H4: { close: 104, ema20: 103, ema50: 100 }
};

test("discovery preserves BUY when later verification rejects it", () => {
  const discovery = buildDiscoveryLayer({ market: "EURUSD", candidate: "BUY", frames });
  const verification = buildVerificationLayer({
    discovery,
    marketReview: { approved: false, blockers: ["M5 trigger missing"] },
    deterministicFallback: { approved: false, reasons: ["spread too wide"] },
    agentGate: { approved: false, reasons: ["weak agreement"] },
    staleTimeframes: [],
    macroBlocked: false,
    spreadVerified: false
  });
  assert.equal(discovery.candidate, "BUY");
  assert.equal(verification.status, "REJECTED");
  assert.equal(verification.candidate, "BUY");
  assert.equal(verification.candidatePreserved, true);
});

test("optional LLM outage does not veto deterministic verification", () => {
  const discovery = buildDiscoveryLayer({ market: "BTCUSD", candidate: "SELL", frames });
  const verification = buildVerificationLayer({
    discovery,
    marketReview: { approved: true, blockers: [], trend: { direction: "SELL" }, m5: { confirmed: true } },
    deterministicFallback: { approved: true, reasons: [] },
    agentGate: { approved: true, reasons: [] },
    llmReport: { status: "TIMEOUT" },
    staleTimeframes: [],
    macroBlocked: false,
    spreadVerified: true
  });
  assert.equal(verification.status, "PASSED");
  assert.equal(verification.checks.find(x => x.name === "optional_llm_review").status, "UNAVAILABLE");
});

test("execution layer refuses stale/missing quote and never claims broker execution", () => {
  const discovery = buildDiscoveryLayer({ market: "XAUUSD", candidate: "BUY", frames });
  const result = buildExecutionLayer({
    discovery, verification: { status: "PASSED" },
    plan: { entry: 100, stopLoss: 99, takeProfit: 102, riskReward: "1:2" },
    quote: null, quoteValidation: { valid: false, reason: "quote stale" },
    approval: { approved: true, blockers: [] },
    entryVerification: { approved: true, blockers: [] },
    executionVenueConnected: false
  });
  assert.equal(result.decision, "REJECTED");
  assert.equal(result.executable, false);
  assert.ok(result.blockers.includes("quote stale"));
  assert.ok(result.blockers.includes("Broker execution venue/account is not connected and verified"));
});

test("valid paper setup is distinct from executable broker order", () => {
  const discovery = buildDiscoveryLayer({ market: "EURUSD", candidate: "BUY", frames });
  const result = buildExecutionLayer({
    discovery, verification: { status: "PASSED" },
    plan: { entry: 1.1, stopLoss: 1.09, takeProfit: 1.12, riskReward: "1:2" },
    quote: { bid: 1.1, ask: 1.1001, source: "reference" },
    quoteValidation: { valid: true },
    approval: { approved: true, blockers: [] },
    entryVerification: { approved: true, blockers: [] },
    executionVenueConnected: false
  });
  assert.equal(result.decision, "PAPER SIGNAL APPROVED");
  assert.equal(result.paperApproved, true);
  assert.equal(result.executable, false);
});
