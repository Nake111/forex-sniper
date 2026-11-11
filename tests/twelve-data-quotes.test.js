import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTwelveDataQuote, validateTwelveDataQuote } from "../src/twelve-data-quotes.js";

const now = 1_800_000_000_000;

test("normalizes EUR/USD bid and ask", () => {
  const quote = normalizeTwelveDataQuote({ symbol: "EUR/USD", timestamp: now / 1000,
    price: 1.08, bid: 1.0799, ask: 1.0801, exchange: "FOREX" }, now);
  assert.equal(quote.market, "EURUSD");
  assert.equal(quote.bid, 1.0799);
  assert.equal(validateTwelveDataQuote(quote, { now }).valid, true);
});

test("maps BTC/USD and XAU/USD independently", () => {
  assert.equal(normalizeTwelveDataQuote({ symbol: "BTC/USD", timestamp: now / 1000, price: 70000 }, now).market, "BTCUSD");
  assert.equal(normalizeTwelveDataQuote({ symbol: "XAU/USD", timestamp: now / 1000, price: 2300 }, now).market, "XAUUSD");
});

test("rejects missing bid/ask instead of inventing a spread", () => {
  const quote = normalizeTwelveDataQuote({ symbol: "XAU/USD", timestamp: now / 1000, price: 2300 }, now);
  assert.deepEqual(validateTwelveDataQuote(quote, { now }), {
    valid: false, reason: "Provider did not supply a valid bid/ask spread"
  });
});

test("rejects stale, crossed and future quotes", () => {
  const base = { market: "EURUSD", timestamp: now, receivedAt: now, bid: 1, ask: 1.0001 };
  assert.equal(validateTwelveDataQuote({ ...base, timestamp: now - 16_000 }, { now }).valid, false);
  assert.equal(validateTwelveDataQuote({ ...base, ask: 0.999 }, { now }).valid, false);
  assert.equal(validateTwelveDataQuote({ ...base, timestamp: now + 5_000 }, { now }).valid, false);
});
