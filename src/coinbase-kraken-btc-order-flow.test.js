import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCoinbaseTrade,
  normalizeKrakenTrade,
  normalizeKrakenTicker,
  summarizeAggressorTrades
} from "./coinbase-kraken-btc-order-flow.js";

const now = 1_800_000_000_000;

test("normalizes Coinbase spot aggressor-side trades", () => {
  assert.deepEqual(normalizeCoinbaseTrade({
    product_id: "BTC-USD", trade_id: "123", side: "BUY", size: "0.25",
    time: new Date(now - 1_000).toISOString()
  }), { id: "123", timestamp: now - 1_000, quantity: 0.25, side: "BUY" });
  assert.equal(normalizeCoinbaseTrade({ product_id: "ETH-USD", side: "BUY", size: "1", time: new Date(now).toISOString() }), null);
  assert.equal(normalizeCoinbaseTrade({ product_id: "BTC-USD", side: "UNKNOWN", size: "1", time: new Date(now).toISOString() }), null);
});

test("normalizes Kraken linear perpetual taker-side trades and excludes non-fill events", () => {
  assert.deepEqual(normalizeKrakenTrade({
    product_id: "PF_XBTUSD", uid: "trade-1", side: "sell", qty: 0.4,
    time: now - 500, type: "fill"
  }), { id: "trade-1", timestamp: now - 500, quantity: 0.4, side: "SELL" });
  assert.equal(normalizeKrakenTrade({
    product_id: "PI_XBTUSD", side: "buy", qty: 10, time: now, type: "fill"
  }), null);
  assert.equal(normalizeKrakenTrade({
    product_id: "PF_XBTUSD", side: "buy", qty: 10, time: now, type: "liquidation"
  }), null);
});

test("computes 60-second spot and perpetual CVD from taker side without mixing venues", () => {
  const result = summarizeAggressorTrades([
    { id: "1", timestamp: now - 2_000, quantity: 1.2, side: "BUY" },
    { id: "2", timestamp: now - 1_000, quantity: 0.7, side: "SELL" },
    { id: "old", timestamp: now - 61_000, quantity: 50, side: "SELL" }
  ], now);
  assert.equal(result.buyVolume, 1.2);
  assert.equal(result.sellVolume, 0.7);
  assert.ok(Math.abs(result.cvd - 0.5) < 1e-10);
  assert.equal(result.timestamp, now - 1_000);
  assert.equal(result.tradeCount, 2);
});

test("fails closed when the rolling order-flow window has no recent trades", () => {
  assert.throws(() => summarizeAggressorTrades([
    { id: "old", timestamp: now - 90_000, quantity: 1, side: "BUY" }
  ], now), /No trades in the latest 60-second/);
});

test("normalizes Kraken Futures ticker funding_rate snake_case and zero-omission semantics", () => {
  assert.deepEqual(normalizeKrakenTicker({
    feed: "ticker",
    product_id: "PF_XBTUSD",
    time: now - 250,
    openInterest: 2150.25,
    funding_rate: 0.13599,
    relative_funding_rate: 0.00000412
  }, now), {
    openInterest: 2150.25,
    fundingRate: 0.00000412,
    absoluteFundingRate: 0.13599,
    providerTimestamp: now - 250,
    receivedAt: now
  });
  assert.equal(normalizeKrakenTicker({
    feed: "ticker", product_id: "PF_XBTUSD", time: now,
    openInterest: 2150.25,
    funding_rate: 0.13599
  }, now).fundingRate, 0);
  assert.equal(normalizeKrakenTicker({
    feed: "ticker", product_id: "PI_XBTUSD", time: now,
    openInterest: 2150.25, funding_rate: 0.0001
  }, now), null);
  assert.equal(normalizeKrakenTicker({
    feed: "ticker", product_id: "PF_XBTUSD", time: now,
    openInterest: "not-a-number", funding_rate: 0.0001
  }, now), null);
});
