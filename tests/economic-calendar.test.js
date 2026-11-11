import test from "node:test";
import assert from "node:assert/strict";
import { evaluateEconomicRisk, getEconomicCalendar, normalizeEconomicEvent } from "../src/economic-calendar.js";

const NOW = Date.parse("2026-11-10T08:00:00Z");
const baseEvent = {
  ts: Date.parse("2026-11-10T13:30:00Z") / 1000,
  time: "2026-11-10T13:30:00Z",
  currency: "USD",
  impact: "high",
  title: "US CPI",
  forecast: "3.0%",
  previous: "2.9%",
  actual: "",
  id: "usd-cpi.20261110T1330",
  status: "scheduled",
  moved_from: "",
  period: "2026-10",
  confidence: "official"
};

function payload(events = [baseEvent], overrides = {}) {
  return {
    server_time: NOW / 1000,
    server_time_iso: new Date(NOW).toISOString(),
    generated_at: new Date(NOW - 5 * 60_000).toISOString(),
    from: new Date(NOW - 6 * 60 * 60_000).toISOString(),
    to: new Date(NOW + 7 * 24 * 60 * 60_000).toISOString(),
    count: events.length,
    events,
    attribution: { required: false, text: "Economic calendar by ShowMyTrades", url: "https://showmytrades.com/tools/economic-calendar" },
    ...overrides
  };
}

async function withMockFetch(responseFactory, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = responseFactory;
  try { await fn(); } finally { globalThis.fetch = originalFetch; }
}

test("documented free calendar API response validates and normalizes ts/time fields", async () => {
  await withMockFetch(async () => new Response(JSON.stringify(payload()), { status: 200 }), async () => {
    const result = await getEconomicCalendar({ now: NOW });
    assert.equal(result.status, "AVAILABLE");
    assert.equal(result.provider, "SHOWMYTRADES_FREE");
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].country, "US");
    assert.equal(result.events[0].currency, "USD");
    assert.equal(result.events[0].impact, "HIGH");
    assert.equal(result.events[0].timestamp, Date.parse(baseEvent.time));
    assert.equal(result.events[0].scheduleConfidence, "official");
    assert.equal(result.coverage.requestedDays, 7);
    assert.equal(result.attribution.text, "Economic calendar by ShowMyTrades");
  });
});

test("a valid zero-event window is accepted only with fresh clock and coverage", async () => {
  await withMockFetch(async () => new Response(JSON.stringify(payload([])), { status: 200 }), async () => {
    const result = await getEconomicCalendar({ now: NOW });
    assert.equal(result.status, "AVAILABLE");
    assert.equal(result.count, 0);
  });
});

test("calendar schema errors fail closed", async () => {
  await withMockFetch(async () => new Response(JSON.stringify({ events: "invalid" }), { status: 200 }), async () => {
    const result = await getEconomicCalendar({ now: NOW });
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(evaluateEconomicRisk(result, "EURUSD", NOW).blocked, true);
  });
});

test("stale calendar response fails closed", async () => {
  const stale = payload([baseEvent], { generated_at: new Date(NOW - 60 * 60_000).toISOString() });
  await withMockFetch(async () => new Response(JSON.stringify(stale), { status: 200 }), async () => {
    const result = await getEconomicCalendar({ now: NOW });
    assert.equal(result.status, "UNAVAILABLE");
    assert.match(result.error, /stale/i);
  });
});

test("server clock mismatch fails closed", async () => {
  const invalid = payload([baseEvent], { server_time_iso: new Date(NOW + 60_000).toISOString() });
  await withMockFetch(async () => new Response(JSON.stringify(invalid), { status: 200 }), async () => {
    const result = await getEconomicCalendar({ now: NOW });
    assert.equal(result.status, "UNAVAILABLE");
    assert.match(result.error, /disagree/i);
  });
});

test("event ts and ISO time mismatch fails closed", async () => {
  const invalidEvent = { ...baseEvent, ts: baseEvent.ts + 3600 };
  await withMockFetch(async () => new Response(JSON.stringify(payload([invalidEvent])), { status: 200 }), async () => {
    const result = await getEconomicCalendar({ now: NOW });
    assert.equal(result.status, "UNAVAILABLE");
    assert.match(result.error, /timestamp fields/i);
  });
});

test("tentative or single-source high-impact release today blocks all relevant markets", async () => {
  const uncertain = { ...baseEvent, status: "tentative", confidence: "sources_disagree" };
  await withMockFetch(async () => new Response(JSON.stringify(payload([uncertain])), { status: 200 }), async () => {
    const result = await getEconomicCalendar({ now: NOW });
    assert.equal(result.status, "AVAILABLE");
    assert.equal(result.events[0].timestamp, null);
    assert.equal(evaluateEconomicRisk(result, "BTCUSD", NOW).status, "UNKNOWN_TIME_HIGH_IMPACT");
    assert.equal(evaluateEconomicRisk(result, "XAUUSD", NOW).blocked, true);
  });
});

test("normalizes numeric actual versus consensus without inferring market direction", () => {
  const event = normalizeEconomicEvent({
    id: "us-cpi", name: "US CPI", country: "US", impact: "high",
    release_at_utc: "2026-11-10T13:30:00Z", actual: "3.1%", consensus: "3.0%", prior: "2.9%"
  });
  assert.equal(event.timestamp, Date.parse("2026-11-10T13:30:00Z"));
  assert.equal(event.surprise.direction, "ABOVE_CONSENSUS");
  assert.ok(Math.abs(event.surprise.difference - 0.1) < 1e-9);
  assert.match(event.surprise.note, /not automatically bullish or bearish/i);
});

test("high-impact event blocks inside the 15-minute pre-release window", () => {
  const now = Date.parse("2026-11-10T13:20:00Z");
  const result = evaluateEconomicRisk({
    status: "AVAILABLE",
    events: [{ country: "US", impact: "HIGH", status: "scheduled", timestamp: Date.parse("2026-11-10T13:30:00Z"), date: "2026-11-10", dataStale: false }]
  }, "EURUSD", now);
  assert.equal(result.status, "HIGH");
  assert.equal(result.blocked, true);
});

test("event for unrelated country does not block EUR/USD", () => {
  const now = Date.parse("2026-11-10T13:20:00Z");
  const result = evaluateEconomicRisk({
    status: "AVAILABLE",
    events: [{ country: "JP", impact: "HIGH", status: "scheduled", timestamp: Date.parse("2026-11-10T13:30:00Z"), date: "2026-11-10", dataStale: false }]
  }, "EURUSD", now);
  assert.equal(result.status, "NORMAL");
  assert.equal(result.blocked, false);
});

test("unknown-time high-impact event today fails closed", () => {
  const result = evaluateEconomicRisk({
    status: "AVAILABLE",
    events: [{ country: "US", impact: "HIGH", status: "tentative", timestamp: null, date: "2026-11-10", dataStale: false }]
  }, "BTCUSD", NOW);
  assert.equal(result.status, "UNKNOWN_TIME_HIGH_IMPACT");
  assert.equal(result.blocked, true);
});

test("unavailable calendar blocks all markets", () => {
  const result = evaluateEconomicRisk({ status: "UNAVAILABLE", events: [] }, "XAUUSD", NOW);
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.blocked, true);
});

test("stale relevant records block calendar clearance", () => {
  const result = evaluateEconomicRisk({
    status: "AVAILABLE",
    events: [{ country: "US", impact: "HIGH", status: "scheduled", timestamp: Date.parse("2026-11-12T13:30:00Z"), date: "2026-11-12", dataStale: true }]
  }, "BTCUSD", NOW);
  assert.equal(result.status, "STALE_SOURCE_DATA");
  assert.equal(result.blocked, true);
});
