import test from "node:test";
import assert from "node:assert/strict";
import { fetchBiquoteQuote } from "../src/biquote-quotes.js";

test("Biquote retries a transient stale response and accepts a fresh provider quote", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    const timestamp = Date.now();
    const payload = calls === 1
      ? { symbol: "EURUSD", bid: 1.1, ask: 1.1001, timestamp: timestamp - 60_000, marketState: "open", stale: false }
      : { symbol: "EURUSD", bid: 1.1, ask: 1.1001, timestamp, marketState: "open", stale: false };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await fetchBiquoteQuote("EURUSD", { fetchImpl, attempts: 3, retryDelayMs: 0 });
  assert.equal(calls, 2);
  assert.equal(result.error, null);
  assert.equal(result.quote.market, "EURUSD");
  assert.ok(result.quote.timestamp >= Date.now() - 2_000);
});

test("Biquote never returns a quote when every provider response is stale", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    symbol: "EURUSD", bid: 1.1, ask: 1.1001, timestamp: Date.now() - 60_000,
    marketState: "open", stale: false
  }), { status: 200, headers: { "content-type": "application/json" } });

  const result = await fetchBiquoteQuote("EURUSD", { fetchImpl, attempts: 2, retryDelayMs: 0 });
  assert.equal(result.quote, null);
  assert.match(result.error, /after 2 attempts/);
});

test("Biquote treats HTTP 404 as a terminal no-fresh-tick result without retrying", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ message: "No fresh tick" }), { status: 404 });
  };
  const result = await fetchBiquoteQuote("EURUSD", { fetchImpl, attempts: 3, retryDelayMs: 0 });
  assert.equal(calls, 1);
  assert.equal(result.quote, null);
  assert.match(result.error, /market may be closed|older than five minutes/);
});
