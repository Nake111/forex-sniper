import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGithubResearchIntegrations } from "./github-research-confluence.js";

function risingCandles(count = 200) {
  return Array.from({ length: count }, (_, i) => {
    const close = 1.1 + i * 0.001;
    return { timestamp: 1_800_000_000_000 + i * 300_000, open: close - 0.0001, high: close + 0.0002, low: close - 0.0002, close, volume: 100 + i };
  });
}

function alignedFrames() {
  return Object.fromEntries(["M5", "M15", "H1", "H4"].map(tf => [tf, {
    ema20: 1.25, ema50: 1.20, macd: 0.01, macdSignal: 0,
    atr14: 0.002, adx14: 25, rsi14: 60
  }]));
}

test("five agents independently emit directional signals and 3-of-5 quorum", () => {
  const bars = risingCandles();
  const result = evaluateGithubResearchIntegrations({
    frames: alignedFrames(), candles: bars,
    quoteValidation: { valid: true, spread: 0.0001 }, market: "EURUSD"
  });
  assert.equal(result.agents.length, 5);
  assert.deepEqual(result.agents.map(agent => agent.name), [
    "hpFX multi-timeframe", "ICT/SMC structure", "FxTT market scanner",
    "Gann/Hurst trend", "Systematic breakout"
  ]);
  assert.equal(result.agents.filter(agent => agent.signal === "BUY").length >= 3, true);
  assert.equal(result.consensus.direction, "BUY");
  assert.equal(result.consensus.approved, true);
  assert.equal(result.consensus.requiredVotes, 3);
  assert.equal(result.governance.mayApproveFinalTrade, false);
  assert.equal(result.governance.mayOverrideRiskGates, false);
  assert.equal(result.validationFramework.holdoutAccess, "LOCKED_UNTIL_CANDIDATE_SETTINGS_FROZEN");
});

test("agents fail closed when data, quote, or quorum is insufficient", () => {
  const bars = risingCandles(40);
  const frames = { M5: { atr14: 0.001, adx14: 10, rsi14: 50, ema20: 1, ema50: 1 } };
  const result = evaluateGithubResearchIntegrations({ frames, candles: bars });
  assert.equal(result.agents.length, 5);
  assert.equal(result.agents.find(agent => agent.name === "FxTT market scanner").signal, "NO_SIGNAL");
  assert.equal(result.agents.find(agent => agent.name === "Gann/Hurst trend").signal, "NO_SIGNAL");
  assert.equal(result.consensus.approved, false);
  assert.equal(result.consensus.direction, "NO_SIGNAL");
});
