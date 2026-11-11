import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLiveTick, LIVE_TICK_MAX_AGE_MS } from "../src/live-tick-gate.js";

const now = 1_800_000_000_000;
const fresh = {
  symbol: "EURUSD",
  price: 1.085,
  timestamp: now - 100,
  receivedAt: now - 100,
  source: "test-feed"
};

test("accepts a correctly identified tick within the 800 ms receive-age limit", () => {
  const result = evaluateLiveTick(fresh, "EURUSD", now);
  assert.equal(result.ok, true);
  assert.equal(result.ageMs, 100);
  assert.equal(result.maxAgeMs, 800);
  assert.equal(LIVE_TICK_MAX_AGE_MS, 800);
});

test("rejects a tick older than 800 ms", () => {
  const result = evaluateLiveTick({ ...fresh, receivedAt: now - 801 }, "EURUSD", now);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "LIVE_TICK_STALE");
});

test("rejects missing or invalid tick fields", () => {
  assert.equal(evaluateLiveTick(null, "EURUSD", now).reason, "LIVE_TICK_MISSING");
  assert.equal(evaluateLiveTick({ ...fresh, price: 0 }, "EURUSD", now).reason, "LIVE_TICK_INVALID_FIELDS");
});

test("rejects a tick for a different market", () => {
  const result = evaluateLiveTick(fresh, "XAUUSD", now);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "LIVE_TICK_SYMBOL_MISMATCH");
});

test("rejects a future local receive timestamp", () => {
  const result = evaluateLiveTick({ ...fresh, receivedAt: now + 1 }, "EURUSD", now);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "LIVE_TICK_RECEIVE_TIME_IN_FUTURE");
});
