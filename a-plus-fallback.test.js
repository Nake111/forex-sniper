import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAPlusFallback } from "./src/trading-agents.js";

function panel(direction = "SELL", { risk = true, forecastOpposing = false } = {}) {
  const technicalDirections = [direction, direction, direction,
    direction === "SELL" ? "HOLD" : "HOLD",
    direction === "SELL" ? "HOLD" : "HOLD",
    direction, direction, direction, direction === "SELL" ? "HOLD" : "HOLD",
    direction === "SELL" ? "HOLD" : "HOLD", direction];
  const names = [
    "Technical analyst", "Momentum analyst", "SMC and liquidity analyst",
    "Macro and news analyst", "Volume and auction analyst",
    "Higher-timeframe confluence analyst", "Volatility and regime analyst",
    "M5 candle-quality analyst", "Momentum exhaustion analyst",
    "Liquidity sweep and reclaim analyst", "Trading-session breakout analyst"
  ];
  const agents = names.map((name, i) => ({ name, direction: i === 5 || i === 6 ? direction : technicalDirections[i] }));
  for (let i = 0; i < 6; i++) agents.push({
    name: `Quantitative agent ${i + 1} — test`,
    direction: i === 0 ? direction : forecastOpposing && i === 1 ? (direction === "BUY" ? "SELL" : "BUY") : "HOLD"
  });
  return { agents, riskManager: { approved: risk } };
}

const tier = signal => ({ signal, tier: "A+", bullishScore: signal === "BUY" ? 18 : 4, bearishScore: signal === "SELL" ? 18 : 4 });

test("A+ fallback accepts strong independent confluence when VWAP is silent", () => {
  const result = evaluateAPlusFallback("SELL", tier("SELL"), "SELL", panel("SELL"), { eventRisk: "NORMAL" });
  assert.equal(result.approved, true);
  assert.equal(result.quality, "A_PLUS_CONFLUENCE");
});

test("A+ fallback rejects non-A+ tiers and VWAP/legacy directional conflicts", () => {
  assert.equal(evaluateAPlusFallback("SELL", { ...tier("SELL"), tier: "B" }, "SELL", panel("SELL"), { eventRisk: "NORMAL" }).approved, false);
  assert.equal(evaluateAPlusFallback("SELL", tier("SELL"), "BUY", panel("SELL"), { eventRisk: "NORMAL" }).approved, false);
});

test("A+ fallback never bypasses event risk, stale data or risk-manager veto", () => {
  assert.equal(evaluateAPlusFallback("SELL", tier("SELL"), "SELL", panel("SELL"), { eventRisk: "HIGH" }).approved, false);
  assert.equal(evaluateAPlusFallback("SELL", tier("SELL"), "SELL", panel("SELL", { risk: false }), { eventRisk: "NORMAL" }).approved, false);
  assert.equal(evaluateAPlusFallback("SELL", tier("SELL"), "SELL", panel("SELL"), { eventRisk: "NORMAL", dataStale: true }).approved, false);
});

test("A+ fallback rejects opposing quantitative forecasts", () => {
  assert.equal(evaluateAPlusFallback("SELL", tier("SELL"), "SELL", panel("SELL", { forecastOpposing: true }), { eventRisk: "NORMAL" }).approved, false);
});
