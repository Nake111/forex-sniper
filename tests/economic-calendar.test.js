import test from "node:test";
import assert from "node:assert/strict";
import { evaluateEconomicRisk, getEconomicCalendar, normalizeEconomicEvent } from "../src/economic-calendar.js";

test("free calendar provider response is validated and normalized", async () => {
  const originalFetch = globalThis.fetch;
  const now = Date.parse("2026-11-10T08:00:00Z");
  globalThis.fetch = async () => new Response(JSON.stringify({
    server_time: now / 1000,
    generated_at: new Date(now).toISOString(),
    count: 1,
    events: [{
      id: "usd-cpi", time: "2026-11-10T13:30:00Z", currency: "USD",
      impact: "high", title: "US CPI", forecast: "3.0%", previous: "2.9%",
      actual: "", status: "scheduled", confidence: "official"
    }]
  }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const result = await getEconomicCalendar({ now });
    assert.equal(result.status, "AVAILABLE");
    assert.equal(result.provider, "SHOWMYTRADES_FREE");
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].country, "US");
    assert.equal(result.events[0].impact, "HIGH");
    assert.equal(result.events[0].timestamp, Date.parse("2026-11-10T13:30:00Z"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("calendar schema errors fail closed", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ events: "invalid" }), { status: 200 });
  try {
    const result = await getEconomicCalendar();
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(evaluateEconomicRisk(result, "EURUSD").blocked, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stale calendar response fails closed", async () => {
  const originalFetch = globalThis.fetch;
  const now = Date.parse("2026-11-10T08:00:00Z");
  globalThis.fetch = async () => new Response(JSON.stringify({
    server_time: now / 1000,
    generated_at: new Date(now - 60 * 60_000).toISOString(),
    events: [{ id: "usd-cpi", time: "2026-11-10T13:30:00Z", currency: "USD", impact: "high", title: "US CPI", status: "scheduled" }]
  }), { status: 200 });
  try {
    const result = await getEconomicCalendar({ now });
    assert.equal(result.status, "UNAVAILABLE");
    assert.match(result.error, /stale/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
