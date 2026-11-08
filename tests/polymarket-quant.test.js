import test from "node:test";
import assert from "node:assert/strict";
import { isBtcUpDownMarket, secondsToExpiry, mapOutcomeTokens } from "../src/polymarket-quant.js";
test("recognizes BTC Up or Down markets", () => {
  assert.equal(isBtcUpDownMarket({ question: "Bitcoin Up or Down - 5 minutes?" }), true);
  assert.equal(isBtcUpDownMarket({ question: "Will BTC reach 100k?" }), false);
});
test("expiry countdown never goes negative", () => {
  assert.equal(secondsToExpiry("2026-11-08T20:00:10Z", Date.parse("2026-11-08T20:00:00Z")), 10);
  assert.equal(secondsToExpiry("2026-11-08T20:00:00Z", Date.parse("2026-11-08T20:00:10Z")), 0);
});
test("maps outcome tokens by outcome labels, not array position", () => {
  assert.deepEqual(mapOutcomeTokens({ outcomes: ["Down", "Up"], tokenIds: ["d", "u"] }), { up: "u", down: "d" });
  assert.equal(mapOutcomeTokens({ outcomes: ["Yes", "No"], tokenIds: ["y", "n"] }), null);
});
