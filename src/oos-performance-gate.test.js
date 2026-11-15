import test from "node:test";
import assert from "node:assert/strict";
import { evaluateOutOfSamplePaperGate } from "./oos-performance-gate.js";

const cutoff = "2026-01-01T00:00:00.000Z";
function journal(count = 30, netR = 0.5) {
  const events = [];
  for (let i = 0; i < count; i++) {
    const signalId = `s${i}`;
    const createdAt = Date.parse("2026-01-02T00:00:00.000Z") + i * 60_000;
    events.push({ eventType: "PAPER_SIGNAL", signalId, market: "EURUSD", createdAt: new Date(createdAt).toISOString() });
    events.push({
      eventType: "PAPER_OUTCOME", signalId, outcome: netR > 0 ? "WIN" : "LOSS",
      netEstimatedR: netR, resolvedAt: new Date(createdAt + 30_000).toISOString()
    });
  }
  return events;
}

test("approves only adequate profitable forward-paper sample", () => {
  const result = evaluateOutOfSamplePaperGate({ events: journal(), market: "EURUSD", trainingCutoff: cutoff });
  assert.equal(result.approved, true);
  assert.equal(result.metrics.sampleSize, 30);
  assert.equal(result.holdoutRead, false);
});

test("fails closed when frozen cutoff is missing", () => {
  const result = evaluateOutOfSamplePaperGate({ events: journal(), market: "EURUSD" });
  assert.equal(result.approved, false);
  assert.match(result.blockers[0], /AGENT_TRAINING_CUTOFF/);
});

test("excludes pre-cutoff trades and other markets", () => {
  const events = journal(30);
  events.push({ eventType: "PAPER_SIGNAL", signalId: "old", market: "EURUSD", createdAt: "2025-12-31T23:00:00Z" });
  events.push({ eventType: "PAPER_OUTCOME", signalId: "old", outcome: "WIN", netEstimatedR: 10, resolvedAt: "2026-01-01T00:30:00Z" });
  const result = evaluateOutOfSamplePaperGate({ events, market: "BTCUSD", trainingCutoff: cutoff });
  assert.equal(result.metrics.sampleSize, 0);
  assert.equal(result.approved, false);
});

test("blocks weak expectancy, low profit factor and excessive drawdown", () => {
  const events = journal(30, -0.5);
  const result = evaluateOutOfSamplePaperGate({ events, market: "EURUSD", trainingCutoff: cutoff });
  assert.equal(result.approved, false);
  assert.ok(result.blockers.some(x => /expectancy/.test(x)));
  assert.ok(result.blockers.some(x => /profit factor/.test(x)));
});

test("ignores unresolved, malformed and future outcomes", () => {
  const events = journal(29);
  events.push({ eventType: "PAPER_SIGNAL", signalId: "pending", market: "EURUSD", createdAt: "2026-01-02T00:00:00Z" });
  events.push({ eventType: "PAPER_OUTCOME", signalId: "pending", outcome: "PENDING", netEstimatedR: 99, resolvedAt: "2026-01-02T00:01:00Z" });
  events.push({ eventType: "PAPER_SIGNAL", signalId: "future", market: "EURUSD", createdAt: "2026-01-02T00:00:00Z" });
  events.push({ eventType: "PAPER_OUTCOME", signalId: "future", outcome: "WIN", netEstimatedR: 99, resolvedAt: "2099-01-01T00:00:00Z" });
  const result = evaluateOutOfSamplePaperGate({ events, market: "EURUSD", trainingCutoff: cutoff });
  assert.equal(result.metrics.sampleSize, 29);
  assert.equal(result.approved, false);
});
