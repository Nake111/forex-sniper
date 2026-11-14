import test from "node:test";
import assert from "node:assert/strict";
import { buildAdaptiveAgentWeights } from "../src/adaptive-agent-weights.js";

const cutoff = "2026-01-01T00:00:00.000Z";
function outcome(agent, side, actual, at = "2025-12-01T00:00:00.000Z", market = "EURUSD") {
  return { eventType: "AGENT_FORECAST_OUTCOME", market, agent, predictedSide: side, actualDirection: actual, forecastAt: at };
}

test("calibrates BUY and SELL independently from training rows only", () => {
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push(outcome("SMC analyst", "BUY", "BUY"));
  for (let i = 0; i < 30; i++) rows.push(outcome("SMC analyst", "SELL", "BUY"));
  // Deliberately opposite outcomes after the frozen cutoff must not affect weights.
  for (let i = 0; i < 100; i++) rows.push(outcome("SMC analyst", "BUY", "SELL", "2026-02-01T00:00:00.000Z"));
  const report = buildAdaptiveAgentWeights({ market: "EURUSD", outcomes: rows, trainingCutoff: cutoff });
  assert.equal(report.enabled, true);
  assert.equal(report.weights["SMC analyst"].BUY.sampleSize, 30);
  assert.equal(report.weights["SMC analyst"].BUY.accuracyPct, 100);
  assert.equal(report.weights["SMC analyst"].BUY.multiplier, 1.25);
  assert.equal(report.weights["SMC analyst"].SELL.accuracyPct, 0);
  assert.equal(report.weights["SMC analyst"].SELL.multiplier, 0.75);
});

test("insufficient sample retains neutral baseline weights", () => {
  const rows = Array.from({ length: 29 }, () => outcome("Momentum analyst", "BUY", "BUY"));
  const report = buildAdaptiveAgentWeights({ market: "EURUSD", outcomes: rows, trainingCutoff: cutoff });
  assert.equal(report.enabled, false);
  assert.deepEqual(report.weights, {});
});

test("market outcomes cannot calibrate another market", () => {
  const rows = Array.from({ length: 40 }, () => outcome("Trend analyst", "BUY", "BUY", "2025-12-01T00:00:00.000Z", "BTCUSD"));
  const report = buildAdaptiveAgentWeights({ market: "EURUSD", outcomes: rows, trainingCutoff: cutoff });
  assert.equal(report.enabled, false);
});

test("missing frozen cutoff disables calibration", () => {
  const rows = Array.from({ length: 40 }, () => outcome("Trend analyst", "BUY", "BUY"));
  const report = buildAdaptiveAgentWeights({ market: "EURUSD", outcomes: rows });
  assert.equal(report.enabled, false);
  assert.match(report.reason, /AGENT_TRAINING_CUTOFF/);
});
