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
