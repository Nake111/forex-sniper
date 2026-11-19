import test from "node:test";
import assert from "node:assert/strict";
import { buildPaperPerformance } from "./paper-performance.js";

const signal = (id, createdAt, strategyId = "A") => ({
  eventType: "PAPER_SIGNAL", signalId: id, market: "BTCUSD", side: "BUY",
  createdAt, strategy: { strategyId, session: "LONDON", profile: "STRICT" }
});
const outcome = (id, outcomeName, r, resolvedAt, commission = true) => ({
  eventType: "PAPER_OUTCOME", signalId: id, outcome: outcomeName,
  netEstimatedR: r, netEstimatedRExcludingCommission: r,
  grossR: r, resolvedAt, estimatedCommissionCostR: commission ? 0.01 : null
});

test("Phase 3 calculates expectancy, profit factor, payoff and chronological drawdown", () => {
  const events = [
    signal("s1", "2026-01-01T00:00:00Z"), outcome("s1", "WIN", 2, "2026-01-01T00:05:00Z"),
    signal("s2", "2026-01-01T00:06:00Z"), outcome("s2", "LOSS", -1, "2026-01-01T00:10:00Z"),
    signal("s3", "2026-01-01T00:11:00Z"), outcome("s3", "WIN", 1, "2026-01-01T00:15:00Z")
  ];
  const t = buildPaperPerformance(events).totals;
  assert.equal(t.expectancyR, 0.6667);
  assert.equal(t.totalNetEstimatedR, 2);
  assert.equal(t.profitFactor, 3);
  assert.equal(t.averageWinR, 1.5);
  assert.equal(t.averageLossR, -1);
  assert.equal(t.payoffRatio, 1.5);
  assert.equal(t.maxDrawdownR, 1);
  assert.equal(t.winRatePct, 66.67);
});

test("timeouts and ambiguous outcomes are excluded from decisive win-rate denominator", () => {
  const events = [
    signal("a", "2026-01-01T00:00:00Z"), outcome("a", "WIN", 1, "2026-01-01T00:01:00Z"),
    signal("b", "2026-01-01T00:02:00Z"), outcome("b", "LOSS", -1, "2026-01-01T00:03:00Z"),
    signal("c", "2026-01-01T00:04:00Z"), outcome("c", "TIMEOUT", 0.2, "2026-01-01T00:05:00Z"),
    signal("d", "2026-01-01T00:06:00Z"), outcome("d", "AMBIGUOUS", null, "2026-01-01T00:07:00Z")
  ];
  const t = buildPaperPerformance(events).totals;
  assert.equal(t.winRatePct, 50);
  assert.equal(t.timeouts, 1);
  assert.equal(t.ambiguous, 1);
  assert.equal(t.rCoverage.resolvedWithoutNetR, 1);
});

test("pending signals are not counted as resolved or in R statistics", () => {
  const t = buildPaperPerformance([signal("pending", "2026-01-01T00:00:00Z")]).totals;
  assert.equal(t.pending, 1);
  assert.equal(t.resolved, 0);
  assert.equal(t.expectancyR, null);
  assert.equal(t.maxDrawdownR, 0);
});
