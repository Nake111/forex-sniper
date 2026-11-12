import test from "node:test";
import assert from "node:assert/strict";
import { decideBrainAction } from "../src/brain-decision.js";

const base = {
  market: "EURUSD",
  candidate: "BUY",
  weightedScore: { status: "ELIGIBLE_FOR_RISK_GATE", score: 88 },
  verificationLayer: { status: "PASSED", blockers: [] },
  approval: { approved: true, decision: "BUY", blockers: [] },
  entryVerification: { approved: true, decision: "BUY", blockers: [] },
  executionLayer: { paperApproved: true },
  hardBlockers: []
};

test("unified brain approves only when every independent paper gate passes", () => {
  const result = decideBrainAction(base);
  assert.equal(result.action, "BUY");
  assert.equal(result.approved, true);
  assert.equal(result.mode, "PAPER_RESEARCH_ONLY");
  assert.equal(result.brokerExecutionEnabled, false);
});

test("unified brain vetoes a candidate when any mandatory gate fails", () => {
  const result = decideBrainAction({ ...base, dataStale: true });
  assert.equal(result.action, "NO TRADE");
  assert.equal(result.approved, false);
  assert.ok(result.blockers.includes("STALE_OR_INCOMPLETE_MARKET_DATA"));
});

test("unified brain does not treat candidate score as approval", () => {
  const result = decideBrainAction({ ...base, weightedScore: { status: "REJECTED", score: 99 } });
  assert.equal(result.action, "NO TRADE");
});

test("unified brain rejects disagreement between candidate and approval direction", () => {
  const result = decideBrainAction({ ...base, approval: { approved: true, decision: "SELL" } });
  assert.equal(result.action, "NO TRADE");
});

test("no directional candidate produces no trade", () => {
  const result = decideBrainAction({ ...base, candidate: "HOLD" });
  assert.equal(result.action, "NO TRADE");
});
