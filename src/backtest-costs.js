const DEFAULTS = Object.freeze({
  EURUSD: { spreadBps: 0.55, slippageBps: 0.1, commissionBps: 0, spreadSource: "201 Railway heartbeat samples; p95 reference spread 0.541 bps" },
  BTCUSD: { spreadBps: 0.22, slippageBps: 2, commissionBps: 0, spreadSource: "201 Coinbase WebSocket heartbeat samples; p95 reference spread 0.213 bps" },
  XAUUSD: { spreadBps: 0.43, slippageBps: 2, commissionBps: 0, spreadSource: "201 Biquote MT5 heartbeat samples; p95 reference spread 0.427 bps" }
});

function readNonNegative(env, key, fallback) {
  const value = env[key] === undefined || env[key] === "" ? fallback : Number(env[key]);
  if (!Number.isFinite(value) || value < 0) throw new Error(key + " must be a finite non-negative number");
  return value;
}

/**
 * Explicit round-trip friction assumptions. Spread is charged once for the
 * round trip; slippage is charged once on entry and once on exit.
 * These are simulation assumptions, not measured broker fills.
 */
export function resolveBacktestCosts(market, env = process.env) {
  const defaults = DEFAULTS[market];
  if (!defaults) throw new Error("Unsupported market for backtest costs: " + market);
  if (env.BACKTEST_COST_BPS !== undefined && env.BACKTEST_COST_BPS !== "") {
    const roundTripCostBps = readNonNegative(env, "BACKTEST_COST_BPS", 0);
    return { market, spreadBps: null, slippageBpsPerSide: null, commissionBps: null,
      roundTripCostBps, model: "LEGACY_COMBINED_COST" };
  }
  const spreadBps = readNonNegative(env, "BACKTEST_SPREAD_BPS", defaults.spreadBps);
  const slippageBpsPerSide = readNonNegative(env, "BACKTEST_SLIPPAGE_BPS", defaults.slippageBps);
  const commissionBps = readNonNegative(env, "BACKTEST_COMMISSION_BPS", defaults.commissionBps);
  return { market, spreadBps, slippageBpsPerSide, commissionBps, spreadSource: defaults.spreadSource,
    roundTripCostBps: spreadBps + 2 * slippageBpsPerSide + commissionBps,
    model: "SPREAD_PLUS_TWO_SIDED_SLIPPAGE_PLUS_COMMISSION" };
}
