import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLiveMarketSync } from "./live-market-sync.js";

const now = Date.parse("2026-11-24T18:00:00.000Z");
function fixture() {
  const cycle = new Date(now - 20_000).toISOString();
  const candleAt = new Date(now - 60_000).toISOString();
  const signals = { analysisCycle: { id: cycle }, markets: {} };
  const marketData = { analysisCycle: { id: cycle }, validation: { status: "PASS" }, markets: {} };
  for (const [i, market] of ["EURUSD", "BTCUSD", "XAUUSD"].entries()) {
    const timestamp = now - 2_000 - i * 1_000;
    signals.markets[market] = {
      analysisCycle: { id: cycle },
      quote: { bid: 1 + i, ask: 1.0001 + i, timestamp, validated: true, timestampQuality: "PROVIDER_TIMESTAMP" },
      quoteRefresh: { status: "PASS" }
    };
    marketData.markets[market] = { timeframes: { M5: {
      status: "PASS", gapCount: 0, latestClosedAt: candleAt
    } } };
  }
  return { signals, marketData };
}

test("passes one synchronized three-market snapshot", () => {
  const input = fixture();
  const result = evaluateLiveMarketSync({ ...input, now });
  assert.equal(result.status, "PASS");
  assert.equal(result.quoteTimestampSkewMs, 2_000);
});

test("blocks quote timestamps outside the synchronization window", () => {
  const input = fixture();
  input.signals.markets.EURUSD.quote.timestamp = now - 15_000;
  input.signals.markets.XAUUSD.quote.timestamp = now + 1_000;
  const result = evaluateLiveMarketSync({ ...input, now, maxQuoteSkewMs: 15_000 });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.failures.some(x => x.includes("not synchronized")));
});

test("blocks stale provider quotes", () => {
  const input = fixture();
  input.signals.markets.BTCUSD.quote.timestamp = now - 20_000;
  const result = evaluateLiveMarketSync({ ...input, now });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.failures.some(x => x.includes("BTCUSD") && x.includes("stale")));
});

test("blocks mismatched cycles and candle timestamps", () => {
  const input = fixture();
  input.marketData.analysisCycle.id = "different-cycle";
  input.marketData.markets.XAUUSD.timeframes.M5.latestClosedAt = new Date(now - 300_000).toISOString();
  const result = evaluateLiveMarketSync({ ...input, now });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.failures.some(x => x.includes("analysis cycle")));
  assert.ok(result.failures.some(x => x.includes("same latest closed M5")));
});

test("blocks missing provider timestamps and non-PASS refreshes", () => {
  const input = fixture();
  input.signals.markets.EURUSD.quote.timestampQuality = "RECEIVED_AT_ONLY";
  input.signals.markets.BTCUSD.quoteRefresh.status = "BLOCKED";
  const result = evaluateLiveMarketSync({ ...input, now });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.failures.some(x => x.includes("EURUSD")));
  assert.ok(result.failures.some(x => x.includes("BTCUSD")));
});
