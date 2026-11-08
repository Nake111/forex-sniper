import test from "node:test";
import assert from "node:assert/strict";
import { getSessionContext } from "./src/sessions.js";

const candle = (iso, high = 1.1, low = 1.0, close = 1.05) => ({
  timestamp: Date.parse(iso), high, low, close
});

test("detects London session and builds its running range", () => {
  const bars = [
    candle("2026-11-09T07:00:00Z", 1.12, 1.01, 1.08),
    candle("2026-11-09T08:00:00Z", 1.15, 1.02, 1.10)
  ];
  const result = getSessionContext(bars);
  assert.equal(result.primary, "LONDON");
  assert.equal(result.active.includes("London"), true);
  assert.equal(result.active.includes("Tokyo"), true);
  assert.equal(result.rangeHigh, 1.15);
  assert.equal(result.rangeLow, 1.01);
  assert.equal(result.breakout, "NONE");
});

test("detects a bullish breakout above the earlier active-session range", () => {
  const bars = [
    candle("2026-11-09T07:00:00Z", 1.10, 1.00, 1.05),
    candle("2026-11-09T07:05:00Z", 1.12, 1.02, 1.11),
    candle("2026-11-09T07:10:00Z", 1.18, 1.08, 1.15)
  ];
  const result = getSessionContext(bars);
  assert.equal(result.breakout, "BULLISH");
  assert.equal(result.rangeHigh, 1.18);
});

test("detects a bearish breakout below the earlier active-session range", () => {
  const bars = [
    candle("2026-11-09T07:00:00Z", 1.10, 1.00, 1.05),
    candle("2026-11-09T07:05:00Z", 1.08, 0.99, 1.01),
    candle("2026-11-09T07:10:00Z", 1.02, 0.92, 0.95)
  ];
  assert.equal(getSessionContext(bars).breakout, "BEARISH");
});

test("detects London/New York overlap", () => {
  const result = getSessionContext([candle("2026-11-09T14:00:00Z")]);
  assert.equal(result.primary, "LONDON_NEW_YORK_OVERLAP");
  assert.equal(result.isMajorSession, true);
});

test("detects overnight Sydney session after midnight", () => {
  const result = getSessionContext([candle("2026-11-09T02:00:00Z")]);
  assert.equal(result.active.includes("Sydney"), true);
});

test("normalizes second-based timestamps and applies a UTC offset", () => {
  const result = getSessionContext([{
    timestamp: Date.parse("2026-11-09T06:00:00Z") / 1000,
    high: 1.1, low: 1.0, close: 1.05
  }], { utcOffset: 1 });
  assert.equal(result.active.includes("London"), true);
});

test("returns a safe empty context for missing or invalid candles", () => {
  assert.equal(getSessionContext([]).primary, "OFF_SESSION");
  assert.equal(getSessionContext([{ timestamp: "bad" }]).breakout, "NONE");
});
