import test from "node:test";
import assert from "node:assert/strict";
import { buildRecoveryPlan, classifyRecoveryBlockers } from "./recovery-orchestrator.js";

test("temporary quote and provider failures recommend a bounded recheck", () => {
  const plan = buildRecoveryPlan({ blockers: ["Quote is stale", "Provider unavailable"] });
  assert.equal(plan.status, "RECHECK_RECOMMENDED");
  assert.equal(plan.canRetry, true);
  assert.equal(plan.retrySteps.length, 5);
  assert.equal(plan.approvalGranted, false);
});

test("hard risk failures cannot be cleared by retries or trader consensus", () => {
  const plan = buildRecoveryPlan({
    blockers: ["Risk/reward below minimum", "Quote is stale"],
    traderEvidence: [{ verified: true, timestamp: "2026-11-12T12:00:00Z",
      symbol: "EURUSD", direction: "BUY", source: "Public analyst" }]
  });
  assert.equal(plan.status, "HARD_BLOCKED");
  assert.equal(plan.canRetry, false);
  assert.equal(plan.externalTraderEvidence.verifiedIdeas.length, 1);
  assert.equal(plan.externalTraderEvidence.mayOverrideValidation, false);
  assert.equal(plan.approvalGranted, false);
});

test("unverified or incomplete trader ideas are discarded", () => {
  const plan = buildRecoveryPlan({ traderEvidence: [
    { verified: false, timestamp: "2026-11-12T12:00:00Z", symbol: "EURUSD", direction: "BUY" },
    { verified: true, symbol: "EURUSD", direction: "SELL" }
  ] });
  assert.equal(plan.externalTraderEvidence.verifiedIdeas.length, 0);
  assert.equal(plan.externalTraderEvidence.status, "UNAVAILABLE_OR_UNVERIFIED");
});

test("retries stop after two attempts and cannot be configured above two", () => {
  const plan = buildRecoveryPlan({
    blockers: ["Network timeout"], attempt: 2, maxAttempts: 9
  });
  assert.equal(plan.maxAttempts, 2);
  assert.equal(plan.canRetry, false);
  assert.equal(plan.status, "RETRY_LIMIT_REACHED");
});

test("unknown blockers remain unresolved rather than being silently ignored", () => {
  const result = classifyRecoveryBlockers(["Mystery validation condition"]);
  assert.deepEqual(result.unresolved, ["Mystery validation condition"]);
  const plan = buildRecoveryPlan({ blockers: ["Mystery validation condition"] });
  assert.equal(plan.status, "UNRESOLVED_BLOCKERS");
  assert.equal(plan.approvalGranted, false);
});
