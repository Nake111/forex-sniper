import test from "node:test";
import assert from "node:assert/strict";
import { evaluateEconomicRisk, getEconomicCalendar, normalizeEconomicEvent } from "../src/economic-calendar.js";

test("removed provider makes no request and fails closed", async () => {
  const result = await getEconomicCalendar({ now: Date.UTC(2026, 10, 10) });
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.provider, "NO_AUTOMATED_PROVIDER");
  assert.equal(result.events.length, 0);
  assert.match(result.error, /no automated economic calendar provider/i);
  assert.equal(evaluateEconomicRisk(result, "EURUSD").blocked, true);
});

test("normalizes event timestamps and compares numeric actual with consensus", () => {
  const event = normalizeEconomicEvent({
    id: "us-cpi", name: "US CPI", country: "US", impact: "high",
    release_at_utc: "2026-11-10T13:30:00Z", actual: "3.1%", consensus: "3.0%", prior: "2.9%"
  });
  assert.equal(event.timestamp, Date.parse("2026-11-10T13:30:00Z"));
  assert.equal(event.surprise.direction, "ABOVE_CONSENSUS");
  assert.ok(Math.abs(event.surprise.difference - 0.1) < 1e-9);
});

test("high-impact event blocks inside 15-minute pre-release window", () => {
  const now = Date.parse("2026-11-10T13:20:00Z");
  const result = evaluateEconomicRisk({
    status: "AVAILABLE",
    events: [{ country: "US", impact: "HIGH", status: "confirmed", timestamp: Date.parse("2026-11-10T13:30:00Z"), dataStale: false }]
  }, "EURUSD", now);
  assert.equal(result.status, "HIGH");
  assert.equal(result.blocked, true);
});

test("event for unrelated country does not block market", () => {
  const now = Date.parse("2026-11-10T13:20:00Z");
  const result = evaluateEconomicRisk({
    status: "AVAILABLE",
    events: [{ country: "JP", impact: "HIGH", status: "confirmed", timestamp: Date.parse("2026-11-10T13:30:00Z"), dataStale: false }]
  }, "EURUSD", now);
  assert.equal(result.status, "NORMAL");
  assert.equal(result.blocked, false);
});

test("unknown-time high-impact event today fails closed", () => {
  const now = Date.parse("2026-11-10T08:00:00Z");
  const result = evaluateEconomicRisk({
    status: "AVAILABLE",
    events: [{ country: "US", impact: "HIGH", status: "confirmed", timestamp: null, date: "2026-11-10", dataStale: false }]
  }, "BTCUSD", now);
  assert.equal(result.status, "UNKNOWN_TIME_HIGH_IMPACT");
  assert.equal(result.blocked, true);
});

test("unavailable calendar blocks all markets", () => {
  const result = evaluateEconomicRisk({ status: "UNAVAILABLE", events: [] }, "XAUUSD");
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.blocked, true);
});

test("stale relevant records block calendar clearance", () => {
  const result = evaluateEconomicRisk({
    status: "AVAILABLE",
    events: [{ country: "US", impact: "HIGH", status: "confirmed", timestamp: Date.parse("2026-11-12T13:30:00Z"), date: "2026-11-12", dataStale: true }]
  }, "BTCUSD", Date.parse("2026-11-10T08:00:00Z"));
  assert.equal(result.status, "STALE_SOURCE_DATA");
  assert.equal(result.blocked, true);
});
