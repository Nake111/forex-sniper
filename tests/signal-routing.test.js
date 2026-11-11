import test from "node:test";
import assert from "node:assert/strict";
import { resolvePrimaryDirection } from "../src/vwap-strategies.js";
import { evaluateEconomicRisk } from "../src/economic-calendar.js";

test("VWAP silence does not erase a valid technical BUY candidate", () => {
  assert.equal(resolvePrimaryDirection("BUY", { signal: "HOLD", buys: 0, sells: 1 }).signal, "BUY");
});
test("VWAP cannot create a trade when the primary engine has no candidate", () => {
  assert.equal(resolvePrimaryDirection("HOLD", { signal: "BUY", buys: 3, sells: 0 }).signal, "HOLD");
});
test("two opposing VWAP confirmations veto a technical candidate", () => {
  const result = resolvePrimaryDirection("BUY", { signal: "SELL", buys: 0, sells: 2 });
  assert.equal(result.signal, "HOLD");
  assert.match(result.reason, /opposing direction/);
});
test("same-direction VWAP consensus confirms a technical candidate", () => {
  assert.equal(resolvePrimaryDirection("SELL", { signal: "SELL", buys: 0, sells: 3 }).signal, "SELL");
});
test("medium-impact event has a distinct short-window MEDIUM status", () => {
  const now = Date.parse("2026-11-11T12:00:00.000Z");
  const risk = evaluateEconomicRisk({ status: "AVAILABLE", events: [{
    country: "US", impact: "MEDIUM", status: "scheduled", timestamp: now + 2 * 60_000,
    date: "2026-11-11", releaseTimezone: "UTC", name: "Medium event"
  }] }, "EURUSD", now);
  assert.equal(risk.status, "MEDIUM");
  assert.equal(risk.blocked, true);
  assert.match(risk.reason, /shorter configured medium-impact/);
});
test("high-impact event remains a HIGH hard block", () => {
  const now = Date.parse("2026-11-11T12:00:00.000Z");
  const risk = evaluateEconomicRisk({ status: "AVAILABLE", events: [{
    country: "US", impact: "HIGH", status: "scheduled", timestamp: now + 2 * 60_000,
    date: "2026-11-11", releaseTimezone: "UTC", name: "High event"
  }] }, "EURUSD", now);
  assert.equal(risk.status, "HIGH");
  assert.equal(risk.blocked, true);
  assert.match(risk.reason, /high-impact release protection/);
});
