import test from "node:test";
import assert from "node:assert/strict";
import { auditTradeReturns } from "../src/performance-audit.js";
test("performance audit separates chronological holdout and reports uncertainty", () => {
  const report = auditTradeReturns([{pnl:0.1},{pnl:-0.05},{pnl:0.02},{pnl:-0.01},{pnl:0.03}], {holdoutRatio:0.4});
  assert.equal(report.total.trades,5);
  assert.equal(report.inSample.trades,3);
  assert.equal(report.holdout.trades,2);
  assert.ok(Array.isArray(report.total.winRateWilson95Pct));
  assert.ok(report.total.maxDrawdownPct >= 0);
});
