import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMarketSurveillance } from "../src/market-surveillance.js";

function baseCandles(last = {}) {
  return Array.from({ length: 21 }, (_, i) => ({
    timestamp: i * 300_000,
    open: 99.5,
    high: 101,
    low: 99,
    close: 100,
    volume: 100,
    ...((i === 19) ? last : {})
  }));
}

test("confirms only a range breakout with volatility expansion and volume surge", () => {
  const result = evaluateMarketSurveillance(baseCandles({
    open: 100, high: 103, low: 99, close: 102, volume: 200
  }), {
    atr14: 1.5,
    atrBaseline: 1,
    squeeze: { state: "SQUEEZE_RELEASED", previousState: "SQUEEZE_ON" }
  });
  assert.equal(result.status, "CONFIRMED_BREAKOUT_CANDIDATE");
  assert.equal(result.direction, "BULLISH");
  assert.equal(result.volumeStatus, "SURGE");
  assert.equal(result.researchOnly, true);
  assert.equal(result.voteWeight, 0);
  assert.equal(result.canApproveSignal, false);
});

test("keeps a price breakout as watch-only when volume is not confirmed", () => {
  const result = evaluateMarketSurveillance(baseCandles({
    open: 100, high: 103, low: 99, close: 102, volume: 110
  }), { atr14: 1.4, atrBaseline: 1 });
  assert.equal(result.status, "BREAKOUT_WATCH");
  assert.equal(result.direction, "NONE");
  assert.equal(result.volumeStatus, "NORMAL");
});

test("does not invent volume confirmation when candle volume is absent", () => {
  const candles = baseCandles({ open: 100, high: 103, low: 99, close: 102, volume: 0 });
  for (const candle of candles.slice(0, -1)) candle.volume = 0;
  const result = evaluateMarketSurveillance(candles, { atr14: 1.5, atrBaseline: 1 });
  assert.equal(result.status, "BREAKOUT_WATCH");
  assert.equal(result.volumeStatus, "UNAVAILABLE");
  assert.match(result.note, /tick volume/i);
});

test("does not label a candle inside the prior range as a breakout", () => {
  const result = evaluateMarketSurveillance(baseCandles(), {
    atr14: 1.5,
    atrBaseline: 1,
    squeeze: { state: "SQUEEZE_RELEASED", previousState: "SQUEEZE_ON" }
  });
  assert.equal(result.breakout, "NONE");
  assert.equal(result.status, "NO_SETUP");
});

test("returns unavailable for insufficient candle history", () => {
  const result = evaluateMarketSurveillance(baseCandles().slice(0, 10));
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.canApproveSignal, false);
});
