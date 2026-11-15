import test from "node:test";
import assert from "node:assert/strict";
import { marketAwareMacroDirection, classifyVolumeEvidence, evaluateAgentHistoricalPerformance, validateSmcPriceEvidence } from "./agent-evidence.js";
import { buildAgentForecasts } from "./signal-quality.js";

test("macro direction is market-specific and never reuses gold bias for EURUSD or BTCUSD", () => {
  assert.equal(marketAwareMacroDirection("XAUUSD", { goldMacroBias: "BULLISH" }), "BUY");
  assert.equal(marketAwareMacroDirection("EURUSD", { goldMacroBias: "BULLISH" }), "HOLD");
  assert.equal(marketAwareMacroDirection("BTCUSD", { goldMacroBias: "BEARISH" }), "HOLD");
  assert.equal(marketAwareMacroDirection("EURUSD", { marketBias: { EURUSD: "BEARISH" } }), "SELL");
});

test("volume agent abstains unless provenance confirms trade volume", () => {
  assert.equal(classifyVolumeEvidence({ cvd: { direction: "BUYING" } }).direction, "HOLD");
  assert.equal(classifyVolumeEvidence({ volumeProvenance: "EXCHANGE_TRADE_VOLUME", cvd: { direction: "BUYING" } }).direction, "BUY");
});

test("historical diagnostics count false signals and missed opportunities without holdout leakage", () => {
  const outcomes = [
    { eventType: "AGENT_FORECAST_OUTCOME", agent: "A", predictedSide: "BUY", actualDirection: "BUY", forecastAt: "2026-01-01T00:00:00Z" },
    { eventType: "AGENT_FORECAST_OUTCOME", agent: "A", predictedSide: "SELL", actualDirection: "BUY", forecastAt: "2026-01-02T00:00:00Z" },
    { eventType: "AGENT_FORECAST_OUTCOME", agent: "A", predictedSide: "HOLD", actualDirection: "SELL", forecastAt: "2026-01-03T00:00:00Z" },
    { eventType: "AGENT_FORECAST_OUTCOME", agent: "A", predictedSide: "HOLD", actualDirection: "FLAT", forecastAt: "2026-02-01T00:00:00Z" }
  ];
  const report = evaluateAgentHistoricalPerformance(outcomes, "2026-01-31T00:00:00Z");
  assert.equal(report.resolvedObservations, 3);
  assert.equal(report.agents.A.trueSignals, 1);
  assert.equal(report.agents.A.falseSignals, 1);
  assert.equal(report.agents.A.missedOpportunities, 1);
  assert.equal(report.holdoutUsed, false);
});

test("SMC abstains without sufficient price-history validation", () => {
  assert.equal(validateSmcPriceEvidence([], {}).valid, false);
});

test("HOLD forecasts are journaled so missed directional opportunities can be measured", () => {
  const rows = buildAgentForecasts({
    market: "EURUSD", candleAt: 1000, close: 1.1, atr14: 0.001,
    agents: [{ name: "Abstaining analyst", direction: "HOLD" }]
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].predictedSide, "HOLD");
});
