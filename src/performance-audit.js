// Independent descriptive performance audit. Metrics are not a guarantee of future returns.
export function auditTradeReturns(trades, { holdoutRatio = 0.3 } = {}) {
  if (!Array.isArray(trades) || !Number.isFinite(holdoutRatio) || holdoutRatio <= 0 || holdoutRatio >= 1) {
    throw new Error("Invalid trades or holdout ratio");
  }
  const valid = trades.filter(t => Number.isFinite(t.pnl));
  const summarize = rows => {
    const wins = rows.filter(t => t.pnl > 0);
    const losses = rows.filter(t => t.pnl < 0);
    const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    let equity = 1, peak = 1, maxDrawdown = 0;
    for (const trade of rows) {
      equity *= 1 + trade.pnl;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 0);
    }
    const n = rows.length, p = n ? wins.length / n : 0;
    const z = 1.96, denom = 1 + z * z / Math.max(1, n);
    const center = n ? (p + z * z / (2 * n)) / denom : 0;
    const margin = n ? z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denom : 0;
    return {
      trades: n, wins: wins.length, losses: losses.length,
      winRatePct: n ? Number((p * 100).toFixed(2)) : null,
      winRateWilson95Pct: n ? [Number((Math.max(0, center - margin) * 100).toFixed(2)), Number((Math.min(1, center + margin) * 100).toFixed(2))] : null,
      netReturnPct: Number(((equity - 1) * 100).toFixed(4)),
      averageReturnPct: n ? Number((rows.reduce((s, t) => s + t.pnl, 0) / n * 100).toFixed(4)) : null,
      profitFactor: grossLoss ? Number((grossWin / grossLoss).toFixed(3)) : grossWin > 0 ? null : 0,
      maxDrawdownPct: Number((maxDrawdown * 100).toFixed(3)),
      sampleWarning: n < 30 ? "Fewer than 30 trades: highly uncertain estimate." : null
    };
  };
  const split = Math.floor(valid.length * (1 - holdoutRatio));
  return {
    total: summarize(valid),
    inSample: summarize(valid.slice(0, split)),
    holdout: summarize(valid.slice(split)),
    holdoutRatio,
    methodology: "Chronological split; compounded returns; Wilson 95% interval for win rate. Descriptive only; assumes sequential compounding and does not net overlapping positions; results depend on sample selection and assumed execution costs."
  };
}
