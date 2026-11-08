import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCombinedSignal } from "./combined-signal.js";

function fixture(direction = "BULLISH") {
  const bull = direction === "BULLISH";
  const make = (close, ema20, ema50, ema200, rsi14, macd, poc) => ({
    close, ema20, ema50, ema200, rsi14, macd, macdSignal: 0, poc, atr14: 100,
    structure: { bos: "NONE", bosBarsAgo: null, sweepConfirmed: false, liquiditySweep: "NONE" },
    smartMoney: { swing: { direction: "NEUTRAL", type: "NONE", barsAgo: 99 } },
    squeeze: { direction: bull ? "BULLISH_STRENGTHENING" : "BEARISH_STRENGTHENING" }
  });
  const m5 = make(bull ? 101 : 89, bull ? 100 : 90, 95, 95, bull ? 60 : 40, bull ? 2 : -2, bull ? 99 : 91);
  const m15 = make(bull ? 111 : 79, bull ? 105 : 85, bull ? 102 : 88, 95, bull ? 60 : 40, bull ? 3 : -3, bull ? 100 : 90);
  m15.structure = { bos: direction, bosBarsAgo: 1, sweepConfirmed: false, liquiditySweep: "NONE" };
  const h1 = make(bull ? 120 : 80, bull ? 110 : 90, bull ? 108 : 92, 100, bull ? 60 : 40, bull ? 3 : -3, 100);
  const donchian = {
    M5: { close: m5.close, ema20: m5.ema20, rsi14: m5.rsi14, macd: m5.macd, macdSignal: 0, atr14: 100 },
    M15: { close: m15.close, previousClose: bull ? 99 : 91, channelHigh20: bull ? 110 : 115, channelLow20: bull ? 85 : 80, previousChannelHigh20: bull ? 100 : 105, previousChannelLow20: bull ? 90 : 95, adx14: 25, volumeRatio: 1.5 },
    H1: { close: h1.close, ema50: h1.ema50, ema200: h1.ema200, atr14: 100 }
  };
  if (bull) { donchian.M15.channelHigh20 = 110; donchian.M15.previousChannelHigh20 = 100; }
  else { donchian.M15.channelLow20 = 80; donchian.M15.previousChannelLow20 = 95; }
  return { results: { M5: m5, M15: m15, H1: h1 }, donchian };
}

test("BUY requires aligned higher trend, breakout and M5 trigger", () => {
  assert.equal(evaluateCombinedSignal(fixture()).signal, "BUY");
});
test("SELL requires aligned bearish evidence", () => {
  assert.equal(evaluateCombinedSignal(fixture("BEARISH")).signal, "SELL");
});
test("stale data blocks every trade", () => {
  const result = evaluateCombinedSignal({ ...fixture(), freshness: { ok: false, reasons: ["M5 data too old"] } });
  assert.equal(result.signal, "HOLD");
  assert.equal(result.confirmation, "STALE DATA");
});
test("opposing higher timeframe trend blocks a trade", () => {
  const f = fixture(); f.results.H1.ema50 = 90;
  assert.equal(evaluateCombinedSignal(f).signal, "HOLD");
});
test("missing data fails closed", () => {
  assert.equal(evaluateCombinedSignal({}).signal, "HOLD");
});
test("no breakout or recent BOS means HOLD", () => {
  const f = fixture(); f.donchian.M15.channelHigh20 = 200; f.results.M15.structure.bosBarsAgo = 99;
  assert.equal(evaluateCombinedSignal(f).signal, "HOLD");
});
