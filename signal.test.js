
import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateSignal,
  confirmSignal
} from "./src/signal.js";

function timeframe(
  bullishVotes,
  bearishVotes,
  close = 60000,
  poc = 59000,
  bos = bullishVotes > bearishVotes ? "BULLISH" : "BEARISH"
) {
  return {
    bullishVotes,
    bearishVotes,
    close,
    poc,
    structure: {
      bos,
      sweep: "NONE"
    }
  };
}

test("Strong aligned bullish setup returns BUY", () => {
  assert.equal(evaluateSignal({
    M5: timeframe(4, 0),
    M15: timeframe(4, 0),
    H1: timeframe(3, 0)
  }), "BUY");
});

test("Strong aligned bearish setup returns SELL", () => {
  assert.equal(evaluateSignal({
    M5: timeframe(0, 4, 58000, 59000),
    M15: timeframe(0, 4),
    H1: timeframe(0, 3)
  }), "SELL");
});

test("Mixed market conditions return HOLD", () => {
  assert.equal(evaluateSignal({
    M5: timeframe(2, 2),
    M15: timeframe(2, 2),
    H1: timeframe(2, 2)
  }), "HOLD");
});

test("Bullish setup without bullish structure returns HOLD", () => {
  assert.equal(evaluateSignal({
    M5: timeframe(4, 0, 60000, 59000, "BEARISH"),
    M15: timeframe(4, 0),
    H1: timeframe(3, 0)
  }), "HOLD");
});

test("Price below POC blocks BUY", () => {
  assert.equal(evaluateSignal({
    M5: timeframe(4, 0, 58000, 59000),
    M15: timeframe(4, 0),
    H1: timeframe(3, 0)
  }), "HOLD");
});

test("H1 opposing votes block BUY", () => {
  assert.equal(evaluateSignal({
    M5: timeframe(4, 0),
    M15: timeframe(4, 0),
    H1: timeframe(3, 3)
  }), "HOLD");
});

test("HOLD signal requires no trade", () => {
  assert.equal(confirmSignal("HOLD", {}).status, "NO TRADE");
});

test("BUY waits without squeeze release", () => {
  assert.equal(confirmSignal("BUY", {
    squeeze: {
      momentum: 100,
      state: "SQUEEZE_ON",
      direction: "BULLISH_STRENGTHENING"
    }
  }).status, "WAIT");
});

test("BUY confirms with bullish squeeze release", () => {
  assert.equal(confirmSignal("BUY", {
    squeeze: {
      momentum: 100,
      state: "SQUEEZE_RELEASED",
      releasedNow: true,
      direction: "BULLISH_STRENGTHENING"
    }
  }).status, "H1 ALIGNED");
});

test("BUY rejects bearish squeeze direction", () => {
  assert.equal(confirmSignal("BUY", {
    squeeze: {
      momentum: 100,
      state: "SQUEEZE_RELEASED",
      releasedNow: true,
      direction: "BEARISH_STRENGTHENING"
    }
  }).status, "WAIT");
});

test("SELL confirms with bearish squeeze release", () => {
  assert.equal(confirmSignal("SELL", {
    squeeze: {
      momentum: -100,
      state: "SQUEEZE_RELEASED",
      releasedNow: true,
      direction: "BEARISH_STRENGTHENING"
    }
  }).status, "H1 ALIGNED");
});

test("Missing squeeze momentum returns WAIT", () => {
  assert.equal(confirmSignal("BUY", {
    squeeze: {
      state: "SQUEEZE_RELEASED",
      releasedNow: true,
      direction: "BULLISH_STRENGTHENING"
    }
  }).status, "WAIT");
});
