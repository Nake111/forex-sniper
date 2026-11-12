import test from "node:test";
import assert from "node:assert/strict";
import { createQuoteSnapshot, validateQuoteSnapshot } from "./quote-snapshot.js";

const quote = (overrides = {}) => ({ market: "EURUSD", bid: 1.1, ask: 1.1001, timestamp: 10_000, receivedAt: 10_010,
  source: "Biquote live bid/ask", venue: "Biquote", timestampQuality: "PROVIDER_TIMESTAMP", ...overrides });

test("creates one immutable identified quote snapshot", () => {
  const result = createQuoteSnapshot(quote(), "EURUSD", 10_100);
  assert.equal(result.valid, true);
  assert.ok(result.snapshotId);
  assert.equal(result.quote.snapshotId, result.snapshotId);
  assert.equal(validateQuoteSnapshot(result, result.quote, 10_200).valid, true);
});

test("rejects stale provider quote", () => {
  const result = createQuoteSnapshot(quote(), "EURUSD", 30_001);
  assert.equal(result.valid, false);
  assert.match(result.validation.reason, /stale/);
});

test("rejects missing source, venue or provider timestamp", () => {
  for (const patch of [{ source: null }, { venue: null }, { timestamp: null }]) {
    assert.equal(createQuoteSnapshot(quote(patch), "EURUSD", 10_100).valid, false);
  }
});

test("rejects a quote replaced between decision layers", () => {
  const result = createQuoteSnapshot(quote(), "EURUSD", 10_100);
  assert.equal(validateQuoteSnapshot(result, { ...result.quote, ask: 1.2 }, 10_200).valid, false);
});

test("rejects snapshot that expires before approval", () => {
  const result = createQuoteSnapshot(quote(), "EURUSD", 10_100);
  assert.equal(validateQuoteSnapshot(result, result.quote, 26_000).valid, false);
});
