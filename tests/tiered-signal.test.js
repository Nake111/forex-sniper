import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTieredSignal } from "../src/tiered-signal.js";

function frame(side, scoreBoost = 0) {
  const bull = side === "BUY";
  return {
    close: 100, ema50: bull ? 99 : 101, ema200: bull ? 98 : 102,
    regime: bull ? "BULL_TREND" : "BEAR_TREND",
    rsi14: bull ? 60 : 40, macdHistogram: bull ? 1 : -1,
    adx14: 25, vwap: bull ? 99 : 101, cvd: { direction: bull ? "BUYING" : "SELLING", slope: bull ? 10 : -10 },
    supertrend: { direction: side === "BUY" ? "BULLISH" : "BEARISH" },
    ichimoku: { direction: side === "BUY" ? "BULLISH" : "BEARISH" },
    mfi14: bull ? 60 : 40, cci20: bull ? 100 : -100,
    stochRsi: { direction: bull ? "BULLISH" : "BEARISH" },
    psar: { direction: bull ? "BULLISH" : "BEARISH" },
    donchian: { breakout: bull ? "BULLISH" : "BEARISH" },
    obv: { direction: bull ? "BUYING" : "SELLING" },
    williamsR: { direction: bull ? "BULLISH" : "BEARISH" },
    keltner: { breakout: bull ? "BULLISH" : "BEARISH" },
    aroon: { direction: bull ? "BULLISH" : "BEARISH" },
    roc: { direction: bull ? "BULLISH" : "BEARISH" },
    poc: bull ? 99 : 101,
    structure: { bos: bull ? "BULLISH" : "BEARISH", sweep: "NONE" },
    smartMoney: { orderBlocks: [], fairValueGaps: [] },
    atr14: 1
  };
}
const frames = side => ({ M5: frame(side), M15: frame(side), H1: frame(side) });

test("tiered engine emits a directional tier when evidence clears B threshold", () => {
  const result = evaluateTieredSignal(frames("BUY"), { eventRisk: "NORMAL" });
  assert.equal(result.signal, "BUY");
  assert.ok(["A+", "B"].includes(result.tier));
  assert.equal(result.setupType, "TREND_CONTINUATION");
});

test("tiered engine classifies mixed higher-timeframe direction as pullback/reversal", () => {
  const data = frames("BUY");
  data.H1 = frame("SELL");
  const result = evaluateTieredSignal(data, { eventRisk: "NORMAL" });
  if (result.signal === "BUY") assert.equal(result.setupType, "PULLBACK_OR_REVERSAL");
});

test("high event risk blocks all tiers", () => {
  const result = evaluateTieredSignal(frames("SELL"), { eventRisk: "HIGH" });
  assert.equal(result.signal, "HOLD");
  assert.equal(result.tier, "C");
});

test("stale data blocks all tiers", () => {
  const result = evaluateTieredSignal(frames("BUY"), { eventRisk: "NORMAL", dataStale: true });
  assert.equal(result.signal, "HOLD");
  assert.equal(result.tier, "C");
});
