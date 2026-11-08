// Aggregates closed backtest outcomes by the session observed at signal time.
export function summarizeSessionPerformance(trades) {
  const groups = new Map();
  for (const trade of trades) {
    const key = trade.session || "UNKNOWN";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trade);
  }
  return [...groups.entries()].map(([session, rows]) => {
    const wins = rows.filter(row => row.netR > 0);
    const losses = rows.filter(row => row.netR <= 0);
    const grossWinR = wins.reduce((sum, row) => sum + row.netR, 0);
    const grossLossR = Math.abs(losses.reduce((sum, row) => sum + row.netR, 0));
    return {
      session,
      trades: rows.length,
      winRate: rows.length ? wins.length / rows.length * 100 : 0,
      netR: rows.reduce((sum, row) => sum + row.netR, 0),
      profitFactor: grossLossR > 0 ? grossWinR / grossLossR : null
    };
  }).sort((a, b) => b.trades - a.trades || a.session.localeCompare(b.session));
}
