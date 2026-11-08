import test from "node:test";
import assert from "node:assert/strict";
import { summarizeSessionPerformance } from "./src/session-performance.js";

test("summarizes win rate, net R and profit factor per session", () => {
  const rows = summarizeSessionPerformance([
    { session: "LONDON", netR: 2 },
    { session: "LONDON", netR: -1 },
    { session: "NEW_YORK", netR: 0.5 }
  ]);
  assert.equal(rows[0].session, "LONDON");
  assert.equal(rows[0].trades, 2);
  assert.equal(rows[0].winRate, 50);
  assert.equal(rows[0].netR, 1);
  assert.equal(rows[0].profitFactor, 2);
  assert.equal(rows[1].profitFactor, null);
});
