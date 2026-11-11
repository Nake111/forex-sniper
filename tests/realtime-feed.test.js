import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCoinbaseTicker, normalizeBiquoteStreamTick } from "../src/realtime-feed-core.js";

test("normalizes valid Coinbase BTC ticker and preserves provider timestamp", () => {
  const now = 1_800_000_000_000;
  const quote = normalizeCoinbaseTicker({
    type: "ticker", product_id: "BTC-USD", best_bid: "70000.1",
    best_ask: "70000.2", time: new Date(now).toISOString()
  }, now + 10);
  assert.equal(quote.market, "BTCUSD");
  assert.equal(quote.bid, 70000.1);
  assert.equal(quote.ask, 70000.2);
  assert.equal(quote.timestamp, now);
  assert.equal(quote.timestampQuality, "PROVIDER_TIMESTAMP");
});

test("normalizes Biquote live stream ticks for EURUSD and XAUUSD", () => {
  const now = 1_800_000_000_000;
  const quote = normalizeBiquoteStreamTick({
    symbol: "EURUSD", bid: 1.08, ask: 1.0801,
    timestamp: new Date(now).toISOString(), marketState: "open", stale: false
  }, now + 5);
  assert.equal(quote.market, "EURUSD");
  assert.equal(quote.bid, 1.08);
  assert.equal(quote.ask, 1.0801);
  assert.equal(quote.timestamp, now);
});

test("rejects wrong symbols, crossed books and malformed provider messages", () => {
  assert.equal(normalizeCoinbaseTicker({ type: "ticker", product_id: "ETH-USD", best_bid: "2000", best_ask: "2001" }), null);
  assert.equal(normalizeCoinbaseTicker({ type: "ticker", product_id: "BTC-USD", best_bid: "70001", best_ask: "70000" }), null);
  assert.equal(normalizeBiquoteStreamTick({ symbol: "USDJPY", bid: 150, ask: 151, timestamp: new Date().toISOString() }), null);
});
