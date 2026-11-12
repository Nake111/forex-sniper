import test from "node:test";
import assert from "node:assert/strict";
import { resolveBacktestCosts } from "./backtest-costs.js";

test("uses explicit market-specific spread and two-sided slippage assumptions", () => {
  const eur = resolveBacktestCosts("EURUSD", {});
  assert.equal(eur.roundTripCostBps, 0.75);
  assert.equal(eur.spreadBps, 0.55);
  assert.equal(eur.slippageBpsPerSide, 0.1);
  const btc = resolveBacktestCosts("BTCUSD", {});
  assert.equal(btc.roundTripCostBps, 4.22);
  assert.equal(btc.spreadBps, 0.22);
});

test("allows explicit friction overrides", () => {
  const result = resolveBacktestCosts("EURUSD", {
    BACKTEST_SPREAD_BPS: "0.4", BACKTEST_SLIPPAGE_BPS: "0.2", BACKTEST_COMMISSION_BPS: "0.1"
  });
  assert.equal(result.roundTripCostBps, 0.9);
});

test("preserves legacy combined-cost override", () => {
  const result = resolveBacktestCosts("BTCUSD", { BACKTEST_COST_BPS: "12" });
  assert.equal(result.roundTripCostBps, 12);
  assert.equal(result.model, "LEGACY_COMBINED_COST");
});

test("rejects invalid cost assumptions", () => {
  assert.throws(() => resolveBacktestCosts("EURUSD", { BACKTEST_SLIPPAGE_BPS: "-1" }), /non-negative/);
});
