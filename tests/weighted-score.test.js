import test from "node:test";
import assert from "node:assert/strict";
import { scoreCandidate } from "../src/weighted-score.js";

const bullish = {
  H1: { regime: "BULL_TREND", close: 102, ema20: 101, ema50: 100 },
  H4: { regime: "BULL_TREND", close: 103, ema20: 102, ema50: 100 },
  M15: { rsi14: 60, macdHistogram: 0.2 },
  M5: {
    atr14: 1, atrBaseline: 1,
    lastCandle: { open: 100, high: 102, low: 99, close: 101.8 },
    structure: { bos: "BULLISH", sweep: "SELL_SIDE" },
    smartMoney: { orderBlocks: [] }
  }
};

test("weighted score admits strong candidate to risk gate, not direct execution", () => {
  const result = scoreCandidate({
    market: "EURUSD", direction: "BUY", frames: bullish,
    marketReview: { m5: { confirmed: true }, orderFlow: { direction: "BUY", strength: 3 } },
    quoteValidation: { valid: true, spread: 0.0001 }, spreadVerified: true,
    a1Heart: { status: "READY", direction: "BUY" }
  });
  assert.equal(result.status, "ELIGIBLE_FOR_RISK_GATE");
  assert.ok(result.score >= 75);
  assert.equal(result.coverage, 100);
});

test("missing quote and trigger remain hard blockers regardless of score", () => {
  const result = scoreCandidate({
    market: "EURUSD", direction: "BUY", frames: bullish,
    marketReview: { m5: { confirmed: true } },
    quoteValidation: { valid: false }, spreadVerified: false
  });
  assert.equal(result.status, "REJECTED");
  assert.ok(result.hardBlockers.some(reason => reason.includes("bid/ask")));
});

test("missing data earns no points and reduces coverage", () => {
  const result = scoreCandidate({ market: "BTCUSD", direction: "BUY", frames: {}, spreadVerified: false });
  assert.equal(result.score, 0);
  assert.ok(result.coverage < 70);
  assert.equal(result.components.find(x => x.name === "M15_momentum").status, "UNAVAILABLE");
});

test("score never overrides a missing mandatory M5 trigger", () => {
  const result = scoreCandidate({
    market: "XAUUSD", direction: "BUY", frames: bullish,
    marketReview: { m5: { confirmed: false } },
    quoteValidation: { valid: true, spread: 0.1 }, spreadVerified: true
  });
  assert.ok(result.hardBlockers.some(reason => reason.includes("M5")));
  assert.equal(result.status, "REJECTED");
});
