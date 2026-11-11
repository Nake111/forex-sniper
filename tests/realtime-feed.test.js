import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBinanceBookTicker } from "../src/realtime-feed-core.js";

test("normalizes valid BTC book ticker and stamps receive time", () => {
  const now = 1_800_000_000_000;
  const quote = normalizeBinanceBookTicker({ s: "BTCUSDT", b: "70000.1", a: "70000.2" }, now);
  assert.equal(quote.market, "BTCUSD");
  assert.equal(quote.bid, 70000.1);
  assert.equal(quote.ask, 70000.2);
  assert.equal(quote.timestamp, now);
  assert.equal(quote.timestampQuality, "RECEIVED_AT_ONLY");
});

test("rejects invalid symbol and crossed book", () => {
  assert.equal(normalizeBinanceBookTicker({ s: "ETHUSDT", b: "2000", a: "2001" }), null);
  assert.equal(normalizeBinanceBookTicker({ s: "BTCUSDT", b: "70001", a: "70000" }), null);
});
