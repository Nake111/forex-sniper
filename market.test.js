import test from "node:test";
import assert from "node:assert/strict";
import { rsi, adx, rollingVwap, cumulativeVolumeDeltaProxy } from "./src/market.js";
import { evaluateSignal, hasDirectionalRetest } from "./src/signal.js";

test("RSI returns 50 for a completely flat market", () => assert.equal(rsi(Array(20).fill(1.25), 14), 50));
test("RSI returns 100 for gains without losses", () => assert.equal(rsi(Array.from({ length: 20 }, (_, i) => i + 1), 14), 100));
test("RSI returns 0 for losses without gains", () => assert.equal(rsi(Array.from({ length: 20 }, (_, i) => 20 - i), 14), 0));
test("RSI returns null when there is insufficient history", () => assert.equal(rsi([1, 2, 3], 14), null));

test("rolling VWAP weights typical price by volume", () => {
  assert.equal(rollingVwap([
    { high: 11, low: 9, close: 10, volume: 1 },
    { high: 21, low: 19, close: 20, volume: 3 }
  ], 2), 17.5);
});
test("rolling VWAP returns null when volume is unavailable", () => {
  assert.equal(rollingVwap([{ high: 2, low: 1, close: 1.5, volume: 0 }]), null);
});
test("CVD proxy detects buying and selling candle pressure", () => {
  const buying = [{ high: 10, low: 0, close: 9, volume: 100 }, { high: 10, low: 0, close: 9, volume: 100 }];
  const selling = [{ high: 10, low: 0, close: 1, volume: 100 }, { high: 10, low: 0, close: 1, volume: 100 }];
  assert.equal(cumulativeVolumeDeltaProxy(buying).direction, "BUYING");
  assert.equal(cumulativeVolumeDeltaProxy(selling).direction, "SELLING");
});

function bullishFrame() {
  return {
    close: 110, ema20: 105, ema50: 100, rsi14: 60, macd: 2, macdSignal: 1,
    bullishVotes: 4, bearishVotes: 0, poc: 100, adx14: 25,
    structure: { bos: "BULLISH" }, vwap: 105,
    cvd: { direction: "BUYING", slope: 10 },
    lastCandle: { open: 108, high: 111, low: 104, close: 110 },
    smartMoney: { orderBlocks: [{ direction: "BULLISH", high: 108, low: 104, midpoint: 106, barsAgo: 2, invalidated: false }], fairValueGaps: [] }
  };
}

test("advanced profile requires VWAP, CVD, ADX and an OB/FVG retest", () => {
  const frames = { M5: bullishFrame(), M15: bullishFrame(), H1: bullishFrame() };
  assert.equal(evaluateSignal(frames, "advanced"), "BUY");
  frames.M5.vwap = 115;
  assert.equal(evaluateSignal(frames, "advanced"), "HOLD");
  frames.M5.vwap = 105;
  frames.M5.smartMoney.orderBlocks = [];
  assert.equal(evaluateSignal(frames, "advanced"), "HOLD");
});

test("retest requires candle overlap and directional rejection", () => {
  const frame = bullishFrame();
  assert.equal(hasDirectionalRetest(frame, "BULLISH"), true);
  frame.lastCandle.low = 109;
  assert.equal(hasDirectionalRetest(frame, "BULLISH"), false);
});

test("ADX is unavailable before enough candles", () => {
  assert.equal(adx(Array.from({ length: 20 }, (_, i) => ({ high: i + 2, low: i, close: i + 1 }))), null);
});
test("ADX detects a persistent directional trend", () => {
  const candles = Array.from({ length: 60 }, (_, i) => ({ high: 100 + i * 2 + 1, low: 100 + i * 2 - 1, close: 100 + i * 2 + 0.5 }));
  assert.ok(adx(candles) > 18);
});
test("advanced profile rejects weak ADX trend regimes", () => {
  const frames = { M5: bullishFrame(), M15: bullishFrame(), H1: bullishFrame() };
  frames.M5.adx14 = 14;
  assert.equal(evaluateSignal(frames, "advanced"), "HOLD");
  frames.M5.adx14 = 25;
  frames.M15.adx14 = 16;
  assert.equal(evaluateSignal(frames, "advanced"), "HOLD");
});
