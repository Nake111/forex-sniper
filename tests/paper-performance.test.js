import test from "node:test";
import assert from "node:assert/strict";
import { buildPaperPerformance } from "../src/paper-performance.js";

test("groups approved paper signal outcomes by strategy, market and session", () => {
  const events = [
    { eventType: "PAPER_SIGNAL", signalId: "s1", market: "EURUSD", side: "BUY", strategy: { strategyId: "ORB", session: "LONDON", profile: "balanced" } },
    { eventType: "PAPER_SIGNAL", signalId: "s2", market: "EURUSD", side: "SELL", strategy: { strategyId: "ORB", session: "LONDON", profile: "balanced" } },
    { eventType: "PAPER_SIGNAL", signalId: "s3", market: "BTCUSD", side: "BUY", strategy: { strategyId: "VWAP", session: "NEW_YORK", profile: "strict" } },
    { eventType: "PAPER_OUTCOME", signalId: "s1", outcome: "WIN", grossR: 2, netEstimatedR: null, netEstimatedRExcludingCommission: 1.8 },
    { eventType: "PAPER_OUTCOME", signalId: "s2", outcome: "LOSS", grossR: -1, netEstimatedR: null, netEstimatedRExcludingCommission: -1.2 }
  ];
  const report = buildPaperPerformance(events, "2026-11-12T00:00:00.000Z");
  assert.equal(report.totals.signals, 3);
  assert.equal(report.totals.resolved, 2);
  assert.equal(report.totals.pending, 1);
  assert.equal(report.byStrategy.ORB.winRatePct, 50);
  assert.equal(report.byStrategy.ORB.averageNetEstimatedR, 0.3);
  assert.equal(report.byMarket.BTCUSD.pending, 1);
  assert.equal(report.bySession.LONDON.resolved, 2);
  assert.match(report.byStrategy.ORB.sampleWarning, /Small sample/);
});

test("does not count ambiguous outcomes as resolved wins or losses", () => {
  const report = buildPaperPerformance([
    { eventType: "PAPER_SIGNAL", signalId: "s1", market: "XAUUSD", strategy: { strategyId: "CORE" } },
    { eventType: "PAPER_OUTCOME", signalId: "s1", outcome: "AMBIGUOUS" }
  ]);
  assert.equal(report.totals.resolved, 0);
  assert.equal(report.totals.ambiguous, 1);
});
