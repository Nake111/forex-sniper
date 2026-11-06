
import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateSignal,
  confirmSignal
} from "./src/signal.js";

function timeframe(bullishVotes, bearishVotes, close = 60000, poc = 59000) {
  return {
    bullishVotes,
    bearishVotes,
    close,
    poc,
    structure: {
      bos: bullishVotes > bearishVotes ? "BULLISH" : "BEARISH",
      sweep: "NONE"
    }
  };
}

test("Strong aligned bullish setup returns BUY", () => {
  const result = evaluateSignal({
    M5: timeframe(4, 0),
    M15: timeframe(4, 0),
    H1: timeframe(3, 0)
  });
  assert.equal(result, "BUY");
});

test("Strong aligned bearish setup returns SELL", () => {
  const result = evaluateSignal({
    M5: timeframe(0, 4, 58000, 59000),
    M15: timeframe(0, 4),
    H1: timeframe(0, 3)
  });
  assert.equal(result, "SELL");
});

test("Mixed market conditions return HOLD", () => {
  const result = evaluateSignal({
    M5: timeframe(2, 2),
    M15: timeframe(2, 2),
    H1: timeframe(2, 2)
  });
  assert.equal(result, "HOLD");
});

test("HOLD signal requires no trade", () => {
  const result = confirmSignal("HOLD", {});
  assert.equal(result.status, "NO TRADE");
});

test("BUY waits without bullish squeeze release", () => {
  const result = confirmSignal("BUY", {
    squeeze: {
      momentum: 100,
      state: "SQUEEZE_ON",
      direction: "BULLISH_STRENGTHENING"
    }
  });
  assert.equal(result.status, "WAIT");
});

test("BUY confirms with bullish squeeze release", () => {
  const result = confirmSignal("BUY", {
    squeeze: {
      momentum: 100,
      state: "SQUEEZE_RELEASED",
      releasedNow: true,
      direction: "BULLISH_STRENGTHENING"
    }
  });
  assert.equal(result.status, "H1 ALIGNED");
});
