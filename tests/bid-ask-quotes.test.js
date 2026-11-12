import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchBidAskQuotes, fetchRealtimeFeedQuotes, normalizeCoinbaseRestTicker, normalizeKrakenTicker, validateBidAskQuote
} from "../src/bid-ask-quotes.js";
import {
  fetchBiquoteQuote, normalizeBiquoteTick, validateBiquoteTick
} from "../src/biquote-quotes.js";

const now = Date.now();

test("normalizes Kraken XBT/USD order-book bid/ask without claiming provider timestamp", () => {
  const quote = normalizeKrakenTicker({
    error: [],
    result: { XXBTZUSD: { b: ["70000.1", "1", "1.0"], a: ["70000.2", "1", "1.0"] } }
  }, now);
  assert.equal(quote.market, "BTCUSD");
  assert.equal(quote.bid, 70000.1);
  assert.equal(quote.ask, 70000.2);
  assert.equal(quote.timestampQuality, "RECEIVED_AT_ONLY");
  assert.equal(validateBidAskQuote(quote, { now }).valid, false);
  assert.match(validateBidAskQuote(quote, { now }).reason, /Provider-supplied quote timestamp/);
});

test("rejects crossed, stale and missing quotes", () => {
  const quote = { market: "EURUSD", bid: 1.1, ask: 1.1001, timestamp: now, receivedAt: now, tradeable: true };
  assert.equal(validateBidAskQuote({ ...quote, ask: 1.09 }, { now }).valid, false);
  assert.equal(validateBidAskQuote({ ...quote, timestamp: now - 20_000 }, { now }).valid, false);
  assert.equal(validateBidAskQuote(null, { now }).valid, false);
});

test("realtime feed validates provider time against feed clock, not runner clock", async () => {
  const now = Date.now();
  const feedServerTime = now + 4_000;
  const quote = { market: "BTCUSD", bid: 70_000, ask: 70_001, timestamp: feedServerTime - 500,
    receivedAt: feedServerTime - 400, source: "Coinbase Exchange BTC-USD ticker WebSocket",
    venue: "Coinbase Exchange", timestampQuality: "PROVIDER_TIMESTAMP", tradeable: true };
  const result = await fetchRealtimeFeedQuotes({
    url: "https://feed.example", now, markets: ["BTCUSD"],
    fetchImpl: async () => ({ ok: true, json: async () => ({
      updatedAt: feedServerTime, quotes: { BTCUSD: quote },
      markets: { BTCUSD: { status: "FRESH", ageMs: 500, timestamp: quote.timestamp, bid: quote.bid, ask: quote.ask } }
    }) })
  });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.quotes.BTCUSD.feedServerTime, feedServerTime);
  assert.equal(result.errors.length, 0);
});

test("realtime feed rejects receive-time-only BTC quotes and unhealthy feed snapshots", async () => {
  const now = Date.now();
  const feedServerTime = now;
  const quote = { market: "BTCUSD", bid: 70_000, ask: 70_001, timestamp: now,
    receivedAt: now, source: "Kraken public ticker order book", venue: "Kraken",
    timestampQuality: "RECEIVED_AT_ONLY", tradeable: true };
  const result = await fetchRealtimeFeedQuotes({
    url: "https://feed.example", now, markets: ["BTCUSD"],
    fetchImpl: async () => ({ ok: true, json: async () => ({
      updatedAt: feedServerTime, quotes: { BTCUSD: quote },
      markets: { BTCUSD: { status: "FRESH", ageMs: 0, timestamp: quote.timestamp, bid: quote.bid, ask: quote.ask } }
    }) })
  });
  assert.equal(result.status, "UNAVAILABLE");
  assert.match(result.errors[0], /provider timestamp unavailable/);
});

test("normalizes provider-timestamped Coinbase BTC/USD REST quotes", () => {
  const quote = normalizeCoinbaseRestTicker({
    time: new Date(now).toISOString(), bid: "70000", ask: "70001", price: "70000.5"
  }, now);
  assert.equal(quote.market, "BTCUSD");
  assert.equal(quote.bid, 70000);
  assert.equal(quote.ask, 70001);
  assert.equal(quote.timestampQuality, "PROVIDER_TIMESTAMP");
  assert.equal(validateBidAskQuote(quote, { now }).valid, true);
  assert.equal(normalizeCoinbaseRestTicker({ bid: "70000", ask: "70001" }, now), null);
});

test("fetchBidAskQuotes uses Coinbase REST without credentials for BTCUSD", async () => {
  const fetchImpl = async url => ({
    ok: true,
    json: async () => url.includes("coinbase")
      ? { time: new Date().toISOString(), bid: "70000", ask: "70001", price: "70000.5" }
      : {}
  });
  const result = await fetchBidAskQuotes({ markets: ["BTCUSD"], fetchImpl });
  assert.equal(result.quotes.BTCUSD.bid, 70000);
  assert.equal(result.quotes.BTCUSD.ask, 70001);
  assert.equal(result.quotes.BTCUSD.timestampQuality, "PROVIDER_TIMESTAMP");
  assert.equal(result.status, "COMPLETE");
  assert.ok(result.provider.includes("Coinbase BTCUSD"));
});

test("Kraken rejects empty and crossed public ticker payloads", () => {
  assert.equal(normalizeKrakenTicker({ error: [], result: {} }, now), null);
  assert.equal(normalizeKrakenTicker({
    error: [], result: { XXBTZUSD: { b: ["70002"], a: ["70001"] } }
  }, now), null);
});

test("normalizes fresh Biquote EUR/USD and XAU/USD bid/ask ticks", () => {
  for (const [symbol, market] of [["EURUSD", "EURUSD"], ["XAUUSD", "XAUUSD"]]) {
    const quote = normalizeBiquoteTick({
      symbol, bid: "1.08", ask: "1.0801", mid: "1.08005",
      timestamp: new Date(now).toISOString(), marketState: "open", stale: false,
      source: "MetaTrader 5 (Broker 1)"
    }, now);
    assert.equal(quote.market, market);
    assert.equal(validateBiquoteTick(quote, { now }).valid, true);
  }
});

test("rejects stale, closed, missing and crossed Biquote quotes", () => {
  const base = normalizeBiquoteTick({
    symbol: "EURUSD", bid: 1.08, ask: 1.0801,
    timestamp: new Date(now).toISOString(), marketState: "open", stale: false
  }, now);
  assert.equal(validateBiquoteTick({ ...base, timestamp: now - 20_000 }, { now }).valid, false);
  assert.equal(validateBiquoteTick({ ...base, marketState: "closed" }, { now }).valid, false);
  assert.equal(normalizeBiquoteTick({ symbol: "XAUUSD", bid: 1, ask: 1 }, now), null);
  assert.equal(normalizeBiquoteTick({ symbol: "EURUSD", bid: 1.1, ask: 1.09,
    timestamp: new Date(now).toISOString(), marketState: "open" }, now), null);
});

test("fetchBiquoteQuote reads a live-style quote without credentials", async () => {
  const fetchImpl = async url => ({
    ok: true,
    json: async () => ({
      symbol: url.includes("XAUUSD") ? "XAUUSD" : "EURUSD",
      bid: "1.08", ask: "1.0801", mid: "1.08005",
      timestamp: new Date().toISOString(), marketState: "open", stale: false
    })
  });
  const result = await fetchBiquoteQuote("EURUSD", { fetchImpl });
  assert.equal(result.quote.market, "EURUSD");
  assert.equal(validateBiquoteTick(result.quote).valid, true);
});

test("fetchBidAskQuotes uses Biquote first for EUR/USD and Gold", async () => {
  const fetchImpl = async url => {
    const symbol = url.includes("XAUUSD") ? "XAUUSD" : "EURUSD";
    const base = symbol === "XAUUSD" ? 4000 : 1.08;
    return {
      ok: true,
      json: async () => ({
        symbol, bid: base, ask: base + (symbol === "XAUUSD" ? 0.1 : 0.0001),
        mid: base + (symbol === "XAUUSD" ? 0.05 : 0.00005),
        timestamp: new Date().toISOString(), marketState: "open", stale: false,
        source: "MetaTrader 5 (Broker 1)"
      })
    };
  };
  const result = await fetchBidAskQuotes({ markets: ["EURUSD", "XAUUSD"], fetchImpl });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.quotes.EURUSD.source, "Biquote live bid/ask");
  assert.equal(result.quotes.XAUUSD.source, "Biquote live bid/ask");
});
