import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeOandaPrice, normalizeKrakenTicker, validateBidAskQuote, fetchBidAskQuotes
} from "../src/bid-ask-quotes.js";

const now = Date.now();

test("normalizes OANDA EUR/USD and XAU/USD provider timestamps and bid/ask", () => {
  const payload = {
    instrument: "EUR_USD",
    time: new Date(now).toISOString(),
    tradeable: true,
    bids: [{ price: "1.08001" }],
    asks: [{ price: "1.08013" }]
  };
  const quote = normalizeOandaPrice("EUR_USD", payload, now);
  assert.equal(quote.market, "EURUSD");
  assert.equal(quote.bid, 1.08001);
  assert.equal(quote.ask, 1.08013);
  assert.equal(quote.timestampQuality, "PROVIDER_TIMESTAMP");
  assert.equal(validateBidAskQuote(quote, { now }).valid, true);
  assert.equal(normalizeOandaPrice("XAU_USD", { ...payload, instrument: "XAU_USD" }, now).market, "XAUUSD");
});

test("normalizes Kraken XBT/USD order-book bid/ask without pretending it has provider timestamp", () => {
  const quote = normalizeKrakenTicker({
    error: [],
    result: { XXBTZUSD: { b: ["70000.1", "1", "1.0"], a: ["70000.2", "1", "1.0"] } }
  }, now);
  assert.equal(quote.market, "BTCUSD");
  assert.equal(quote.bid, 70000.1);
  assert.equal(quote.ask, 70000.2);
  assert.equal(quote.timestampQuality, "RECEIVED_AT_ONLY");
  assert.equal(validateBidAskQuote(quote, { now }).valid, true);
});

test("rejects crossed, stale and non-tradeable quotes", () => {
  const quote = {
    market: "EURUSD", bid: 1.1, ask: 1.1001,
    timestamp: now, receivedAt: now, tradeable: true
  };
  assert.equal(validateBidAskQuote({ ...quote, ask: 1.09 }, { now }).valid, false);
  assert.equal(validateBidAskQuote({ ...quote, timestamp: now - 20_000 }, { now }).valid, false);
  assert.equal(validateBidAskQuote({ ...quote, tradeable: false }, { now }).valid, false);
});

test("fetchBidAskQuotes isolates unavailable OANDA credentials and returns Kraken independently", async () => {
  const fetchImpl = async url => ({
    ok: true,
    json: async () => url.includes("kraken.com")
      ? { error: [], result: { XXBTZUSD: { b: ["70000", "1", "1"], a: ["70001", "1", "1"] } } }
      : { prices: [] }
  });
  const result = await fetchBidAskQuotes({
    oandaToken: "", oandaAccountId: "", markets: ["EURUSD", "BTCUSD"],
    fetchImpl
  });
  assert.equal(result.quotes.BTCUSD.bid, 70000);
  assert.equal(result.quotes.EURUSD, undefined);
  assert.equal(result.status, "PARTIAL");
  assert.ok(result.errors.some(error => error.includes("OANDA_API_TOKEN")));
});
