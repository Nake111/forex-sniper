import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGithubResearchIntegrations } from "./github-research-confluence.js";

function candles(count = 160) {
  return Array.from({ length: count }, (_, i) => {
    const close = 1.1 + i * 0.0001 + Math.sin(i / 5) * 0.0003;
    return { timestamp: 1_800_000_000_000 + i * 300_000, open: close - 0.00005, high: close + 0.0002, low: close - 0.0002, close, volume: 100 + i };
  });
}

test("five GitHub research modules return diagnostics but never contribute signal weight", () => {
  const bars = candles();
  const frames = Object.fromEntries(["M5", "M15", "H1", "H4"].map((tf, i) => [tf, {
    ema20: 1.12 + i * 0.0001, ema50: 1.119, macd: 0.001, macdSignal: 0,
    atr14: 0.0005, adx14: 24, rsi14: 58
  }]));
  const result = evaluateGithubResearchIntegrations({
    frames, candles: bars, quoteValidation: { valid: true, spread: 0.00002 }
  });
  assert.deepEqual(Object.keys(result.modules).sort(), [
    "forexResearch", "fxStrategyFramework", "fxttScanner", "gannHurst", "hpfx"
  ]);
  assert.equal(result.governance.externalModuleSignalWeight, 0);
  assert.equal(result.governance.mayApproveTrade, false);
  assert.equal(result.governance.holdoutProtected, true);
  assert.equal(result.modules.fxStrategyFramework.holdoutAccess, "LOCKED_UNTIL_CANDIDATE_SETTINGS_FROZEN");
  assert.equal(result.modules.gannHurst.murreyOctave.levels.length, 9);
});

test("research adapters fail closed with insufficient Gann history", () => {
  const bars = candles(40);
  const frames = { M5: { atr14: 0.001, adx14: 10, rsi14: 50, ema20: 1, ema50: 1 } };
  const result = evaluateGithubResearchIntegrations({ frames, candles: bars });
  assert.equal(result.modules.gannHurst.status, "INSUFFICIENT_HISTORY");
  assert.equal(result.modules.fxttScanner.direction, "NEUTRAL");
  assert.equal(result.governance.externalModuleSignalWeight, 0);
});
