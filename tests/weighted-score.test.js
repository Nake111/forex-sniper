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
  const spread = result.components.find(item => item.name === "quote_and_spread");
  assert.equal(spread.detail.spreadAtr, 0.0001);
  assert.equal(spread.detail.spreadAtrLimit, 0.12);
  assert.equal(result.decision, "CANDIDATE_ONLY");
  assert.equal(result.approved, false);
  assert.equal(result.riskApprovalRequired, true);
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

test("EURUSD missing venue tick-volume is advisory, not a hard A1 veto", () => {
  const result = scoreCandidate({
    market: "EURUSD", direction: "BUY", frames: bullish,
    marketReview: { m5: { confirmed: true }, orderFlow: { direction: "BUY", strength: 3 } },
    quoteValidation: { valid: true, spread: 0.0001 }, spreadVerified: true,
    a1Heart: { status: "UNAVAILABLE", direction: "HOLD" }
  });
  assert.equal(result.hardBlockers.some(reason => reason.startsWith("A1 HEART")), false);
  assert.ok(result.advisories.some(reason => reason.includes("A1 HEART")));
  assert.equal(result.status, "ELIGIBLE_FOR_RISK_GATE");
});

test("BTCUSD can advance independent candidates when A1 HEART is not ready", () => {
  const result = scoreCandidate({
    market: "BTCUSD", direction: "BUY", frames: bullish,
    marketReview: { m5: { confirmed: true }, orderFlow: { direction: "BUY", strength: 3 } },
    quoteValidation: { valid: true, spread: 0.1 }, spreadVerified: true,
    a1Heart: { status: "UNAVAILABLE", direction: "HOLD" }
  });
  assert.equal(result.hardBlockers.some(reason => reason.startsWith("A1 HEART")), false);
  assert.ok(result.advisories.some(reason => reason.includes("A1 HEART")));
  assert.equal(result.status, "ELIGIBLE_FOR_RISK_GATE");
});

test("Pocket Option-style confluence adds candidate points but never approves a trade", () => {
  const frames = {
    ...bullish,
    M5: {
      ...bullish.M5,
      rsi14: 60,
      macdHistogram: 0.2,
      stochastic: { direction: "BULLISH", k: 82, d: 75 },
      candleStreak: { direction: "BULLISH", confirmed: true, streak: 3 },
      rsiWick: { direction: "NONE", confirmed: false }
    }
  };
  const result = scoreCandidate({
    market: "EURUSD", direction: "BUY", frames,
    marketReview: { m5: { confirmed: true }, orderFlow: { direction: "BUY", strength: 3 } },
    quoteValidation: { valid: true, spread: 0.0001 }, spreadVerified: true,
    a1Heart: { status: "READY", direction: "BUY" }
  });
  const confluence = result.components.find(item => item.name === "pocket_option_style_indicator_confluence");
  assert.equal(confluence.status, "PASS");
  assert.equal(confluence.points, 10);
  assert.equal(result.decision, "CANDIDATE_ONLY");
  assert.equal(result.approved, false);
});

test("opposing RSI wick rejection blocks Pocket Option-style confluence points", () => {
  const frames = {
    ...bullish,
    M5: {
      ...bullish.M5,
      rsi14: 60,
      macdHistogram: 0.2,
      stochastic: { direction: "BULLISH" },
      candleStreak: { direction: "BULLISH", confirmed: true },
      rsiWick: { direction: "BEARISH", confirmed: true }
    }
  };
  const result = scoreCandidate({ market: "EURUSD", direction: "BUY", frames });
  const confluence = result.components.find(item => item.name === "pocket_option_style_indicator_confluence");
  assert.equal(confluence.status, "FAIL");
  assert.equal(confluence.points, 0);
});
