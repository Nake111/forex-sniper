import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEconomicEvent,
  evaluateEconomicRisk
} from "./src/economic-calendar.js";

test("calendar unavailable never clears event risk", () => {
  const risk = evaluateEconomicRisk({ status: "UNAVAILABLE", events: [] }, "EURUSD");
  assert.equal(risk.status, "UNKNOWN");
  assert.equal(risk.blocked, true);
});

test("a high-impact EUR/USD event inside the protection window blocks", () => {
  const now = Date.now();
  const event = normalizeEconomicEvent({
    id: "usd-cpi", name: "US CPI", country: "US", impact: "high",
    release_at_utc: new Date(now + 5 * 60_000).toISOString(),
    status: "scheduled", release_tz: "UTC"
  });
  const risk = evaluateEconomicRisk({ status: "AVAILABLE", events: [event] }, "EURUSD", now);
  assert.equal(risk.status, "HIGH");
  assert.equal(risk.blocked, true);
});

test("a high-impact event with an unknown time blocks on its release date", () => {
  const now = Date.now();
  const event = normalizeEconomicEvent({
    id: "usd-cpi-unknown-time", name: "US CPI", country: "US", impact: "high",
    date: new Date(now).toISOString().slice(0, 10), status: "scheduled", release_tz: "UTC"
  });
  const risk = evaluateEconomicRisk({ status: "AVAILABLE", events: [event] }, "EURUSD", now);
  assert.equal(risk.status, "UNKNOWN_TIME_HIGH_IMPACT");
  assert.equal(risk.blocked, true);
});

test("stale calendar events cannot clear event risk", () => {
  const event = normalizeEconomicEvent({
    id: "eur-ecb", name: "ECB rate decision", country: "EU", impact: "high",
    release_at_utc: new Date(Date.now() + 60 * 60_000).toISOString(), data_stale: true
  });
  const risk = evaluateEconomicRisk({ status: "AVAILABLE", events: [event] }, "EURUSD");
  assert.equal(risk.status, "STALE_SOURCE_DATA");
  assert.equal(risk.blocked, true);
});

test("a fresh calendar with no nearby relevant event reports normal", () => {
  const event = normalizeEconomicEvent({
    id: "usd-cpi-later", name: "US CPI", country: "US", impact: "high",
    release_at_utc: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
    status: "scheduled", release_tz: "UTC"
  });
  const risk = evaluateEconomicRisk({ status: "AVAILABLE", events: [event] }, "EURUSD");
  assert.equal(risk.status, "NORMAL");
  assert.equal(risk.blocked, false);
});
