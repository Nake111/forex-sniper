import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSignal, confirmSignal } from "./src/signal.js";

function frame(side = "BULLISH") {
  const bullish = side === "BULLISH";
  return {
    close: 100,
    ema20: bullish ? 101 : 99,
    ema50: bullish ? 100 : 100.5,
    rsi14: bullish ? 60 : 40,
    macd: bullish ? 1 : -1,
    macdSignal: bullish ? 0 : 0,
    bullishVotes: bullish ? 4 : 0,
    bearishVotes: bullish ? 0 : 4,
    poc: bullish ? 99 : 101,
    structure: { bos: bullish ? "BULLISH" : "BEARISH", sweep: "NONE" },
    squeeze: {
      state: "SQUEEZE_RELEASED",
      momentum: bullish ? 1 : -1,
      direction: bullish ? "BULLISH_STRENGTHENING" : "BEARISH_STRENGTHENING"
    }
  };
}

test("aligned bullish M5/M15/H1 plus bullish BOS returns BUY", () => {
  assert.equal(evaluateSignal({ M5: frame(), M15: frame(), H1: frame() }), "BUY");
});

test("aligned bearish M5/M15/H1 plus bearish BOS returns SELL", () => {
  assert.equal(evaluateSignal({
    M5: frame("BEARISH"), M15: frame("BEARISH"), H1: frame("BEARISH")
  }), "SELL");
});

test("mixed timeframes return HOLD", () => {
  assert.equal(evaluateSignal({ M5: frame(), M15: frame("BEARISH"), H1: frame() }), "HOLD");
});

test("missing indicator data safely returns HOLD", () => {
  assert.equal(evaluateSignal({ M5: {}, M15: {}, H1: {} }), "HOLD");
});

test("H1 momentum confirms BUY without requiring a squeeze release state", () => {
  assert.equal(confirmSignal("BUY", frame()).status, "H1 ALIGNED");
});

test("active H1 squeeze blocks entry", () => {
  const h1 = frame();
  h1.squeeze.state = "SQUEEZE_ON";
  assert.equal(confirmSignal("BUY", h1).status, "WAIT");
});

test("opposite H1 momentum blocks entry", () => {
  assert.equal(confirmSignal("BUY", frame("BEARISH")).status, "WAIT");
});
