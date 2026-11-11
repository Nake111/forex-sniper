import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeKrakenTicker, validateBidAskQuote, fetchBidAskQuotes
} from "../src/bid-ask-quotes.js";

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
  assert.equal(validateBidAskQuote(quote, { now }).valid, true);
});

test("rejects crossed, stale and missing quotes", () => {
  const quote = { market: "EURUSD", bid: 1.1, ask: 1.1001, timestamp: now, receivedAt: now, tradeable: true };
  assert.equal(validateBidAskQuote({ ...quote, ask: 1.09 }, { now }).valid, false);
  assert.equal(validateBidAskQuote({ ...quote, timestamp: now - 20_000 }, { now }).valid, false);
  assert.equal(validateBidAskQuote(null, { now }).valid, false);
});

test("fetchBidAskQuotes uses Kraken public ticker without credentials for BTCUSD", async () => {
  const fetchImpl = async url => ({
    ok: true,
    json: async () => url.includes("kraken.com")
      ? { error: [], result: { XXBTZUSD: { b: ["70000", "1", "1"], a: ["70001", "1", "1"] } } }
      : {}
  });
  const result = await fetchBidAskQuotes({ markets: ["BTCUSD"], fetchImpl });
  assert.equal(result.quotes.BTCUSD.bid, 70000);
  assert.equal(result.quotes.BTCUSD.ask, 70001);
  assert.equal(result.status, "COMPLETE");
  assert.match(result.provider, /Twelve Data \+ Kraken/);
});

test("Twelve Data missing bid/ask does not create an executable FX or Gold quote", async () => {
  const result = await fetchBidAskQuotes({ markets: ["EURUSD", "XAUUSD"] });
  assert.equal(result.quotes.EURUSD, undefined);
  assert.equal(result.quotes.XAUUSD, undefined);
  assert.equal(result.status, "UNAVAILABLE");
  assert.ok(result.errors.some(error => /TWELVE_DATA_API_KEY/.test(error) || /bid\/ask|quote|configured/i.test(error)));
});
