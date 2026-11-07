import test from "node:test";
import assert from "node:assert/strict";
import { rsi } from "./src/market.js";

test("RSI returns 50 for a completely flat market", () => {
  assert.equal(rsi(Array(20).fill(1.25), 14), 50);
});

test("RSI returns 100 for gains without losses", () => {
  assert.equal(rsi(Array.from({ length: 20 }, (_, i) => i + 1), 14), 100);
});

test("RSI returns 0 for losses without gains", () => {
  assert.equal(rsi(Array.from({ length: 20 }, (_, i) => 20 - i), 14), 0);
});

test("RSI returns null when there is insufficient history", () => {
  assert.equal(rsi([1, 2, 3], 14), null);
});
