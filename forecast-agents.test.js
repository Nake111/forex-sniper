import test from "node:test";
import assert from "node:assert/strict";
import { runForecastAgents } from "./src/forecast-agents.js";

function candles(count = 180, drift = 0.0002) {
  let close = 1.1;
  return Array.from({ length: count }, (_, index) => {
    close *= Math.exp(drift + Math.sin(index / 5) * 0.00015);
    const range = close * 0.0004;
    return {
      timestamp: 1_800_000_000_000 + index * 300_000,
      open: close * (1 - 0.00005),
      high: close + range,
      low: close - range,
      close,
      volume: 100 + index
    };
  });
}

test("six independent quantitative agents return a three-candle forecast", () => {
  const result = runForecastAgents(candles());
  assert.equal(result.length, 6);
  assert.deepEqual(result.map(agent => agent.name), [
    "Quantitative agent 1 — weighted regression",
    "Quantitative agent 2 — autoregression",
    "Quantitative agent 3 — Kalman filter",
    "Quantitative agent 4 — EWMA volatility",
    "Quantitative agent 5 — cycle model",
    "Quantitative agent 6 — analog search"
  ]);
  for (const agent of result) {
    assert.ok(["BUY", "SELL", "HOLD"].includes(agent.direction));
    assert.equal(agent.horizonCandles, 3);
    assert.ok(agent.probabilityUpPct >= 0 && agent.probabilityUpPct <= 100);
    assert.ok(Number.isFinite(agent.expectedMoveAtr));
    assert.ok(typeof agent.evidence === "string");
  }
});

test("forecast agents fail closed when fewer than 70 candles are available", () => {
  const result = runForecastAgents(candles(40));
  assert.equal(result.length, 6);
  assert.ok(result.every(agent => agent.direction === "HOLD"));
  assert.ok(result.every(agent => agent.probabilityUpPct === 50));
});

test("forecast output uses only supplied candle history and is deterministic", () => {
  const history = candles();
  assert.deepEqual(runForecastAgents(history), runForecastAgents(history));
});
