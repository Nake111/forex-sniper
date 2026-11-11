import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCapitalMarket, normalizeKrakenTicker, validateBidAskQuote, fetchBidAskQuotes
} from "../src/bid-ask-quotes.js";

const now = Date.now();

test("normalizes Capital.com EUR/USD and Gold bid/offer snapshots", () => {
  const base = {
    bid: 1.08001, offer: 1.08013, updateTimeUTC: new Date(now).toISOString(),
    marketStatus: "TRADEABLE", delayTime: 0, epic: "EURUSD"
  };
  const eur = normalizeCapitalMarket(base, "EURUSD", now);
  assert.equal(eur.bid, 1.08001);
  assert.equal(eur.ask, 1.08013);
  assert.equal(eur.venue, "Capital.com");
  assert.equal(validateBidAskQuote(eur, { now }).valid, true);
  const gold = normalizeCapitalMarket({ ...base, epic: "GOLD" }, "XAUUSD", now);
  assert.equal(gold.market, "XAUUSD");
});

test("rejects delayed or closed Capital.com quotes", () => {
  const quote = normalizeCapitalMarket({
    bid: 1.1, offer: 1.1001, updateTimeUTC: new Date(now).toISOString(),
    marketStatus: "CLOSED", delayTime: 0
  }, "EURUSD", now);
  assert.equal(validateBidAskQuote(quote, { now }).valid, false);
});

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

test("rejects crossed and stale quotes", () => {
  const quote = { market: "EURUSD", bid: 1.1, ask: 1.1001, timestamp: now, receivedAt: now, tradeable: true };
  assert.equal(validateBidAskQuote({ ...quote, ask: 1.09 }, { now }).valid, false);
  assert.equal(validateBidAskQuote({ ...quote, timestamp: now - 20_000 }, { now }).valid, false);
});

test("fetchBidAskQuotes isolates missing Capital.com credentials and still obtains Kraken", async () => {
  const fetchImpl = async url => ({
    ok: true,
    json: async () => url.includes("kraken.com")
      ? { error: [], result: { XXBTZUSD: { b: ["70000", "1", "1"], a: ["70001", "1", "1"] } } }
      : {}
  });
  const result = await fetchBidAskQuotes({
    capitalApiKey: "", capitalIdentifier: "", capitalApiPassword: "",
    markets: ["EURUSD", "BTCUSD"], fetchImpl
  });
  assert.equal(result.quotes.BTCUSD.bid, 70000);
  assert.equal(result.quotes.EURUSD, undefined);
  assert.equal(result.status, "PARTIAL");
  assert.ok(result.errors.some(error => error.includes("CAPITAL_API_KEY")));
});

test("Capital.com session and market search use the demo API and parse quote", async () => {
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/api/v1/session")) {
      assert.equal(options.method, "POST");
      assert.equal(JSON.parse(options.body).identifier, "demo@example.com");
      return { ok: true, headers: { get: name => name === "CST" ? "cst-token" : "security-token" }, json: async () => ({}) };
    }
    assert.ok(url.startsWith("https://demo-api-capital.backend-capital.com/"));
    return {
      ok: true, headers: { get: () => null },
      json: async () => ({ markets: [{
        epic: "EURUSD", symbol: "EUR/USD", instrumentName: "EUR/USD",
        instrumentType: "CURRENCIES", expiry: "-", bid: 1.08, offer: 1.0801,
        updateTimeUTC: new Date(now).toISOString(), marketStatus: "TRADEABLE", delayTime: 0
      }] })
    };
  };
  const result = await fetchBidAskQuotes({
    capitalApiKey: "test-key", capitalIdentifier: "demo@example.com",
    capitalApiPassword: "test-password", markets: ["EURUSD"], fetchImpl
  });
  assert.equal(result.quotes.EURUSD.bid, 1.08);
  assert.equal(result.quotes.EURUSD.venue, "Capital.com");
  assert.equal(result.status, "COMPLETE");
});
