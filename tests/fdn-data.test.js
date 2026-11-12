import test from "node:test";
import assert from "node:assert/strict";
import { fetchFdnMinuteCandles, resampleFdnMinuteCandles } from "../src/fdn-data.js";

test("normalizes FinancialData.Net UTC minute candles and filters the open minute", async () => {
  const now = Date.parse("2026-11-12T12:05:30Z");
  const rows = Array.from({ length: 6 }, (_, i) => ({
    trading_symbol: "EURUSD",
    time: new Date(Date.parse("2026-11-12T12:00:00Z") + i * 60_000).toISOString().replace("T", " ").slice(0, 19),
    open: 1.1 + i * 0.0001, high: 1.101 + i * 0.0001,
    low: 1.099 + i * 0.0001, close: 1.1005 + i * 0.0001, volume: 10 + i
  }));
  const result = await fetchFdnMinuteCandles("EURUSD", {
    apiKey: "test-key", now, fetchImpl: async url => {
      assert.equal(new URL(url).searchParams.get("identifier"), "EURUSD");
      assert.equal(new URL(url).searchParams.get("key"), "test-key");
      return { ok: true, json: async () => rows };
    }
  });
  assert.equal(result.status, "OK");
  assert.equal(result.candles.length, 5);
  assert.equal(result.candles[0].timestamp, Date.parse("2026-11-12T12:00:00Z"));
});

test("resamples only complete consecutive M1 groups", () => {
  const start = Date.parse("2026-11-12T12:00:00Z");
  const candles = Array.from({ length: 10 }, (_, i) => ({
    timestamp: start + i * 60_000,
    open: 1 + i, high: 2 + i, low: 0.5 + i, close: 1.5 + i, volume: 2,
  })).filter(candle => candle.timestamp !== start + 6 * 60_000);
  const result = resampleFdnMinuteCandles(candles, 5);
  assert.equal(result.length, 1);
  assert.equal(result[0].open, 1);
  assert.equal(result[0].close, 5.5);
  assert.equal(result[0].volume, 10);
});

test("does not pretend unsupported markets have FDN minute coverage", async () => {
  const result = await fetchFdnMinuteCandles("XAUUSD", { apiKey: "test" });
  assert.equal(result.status, "UNSUPPORTED_MARKET");
});
