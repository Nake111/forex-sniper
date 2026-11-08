/**
 * Approximate position sizing for USD-quoted instruments (EURUSD and BTCUSD).
 * Assumes account currency is USD and one unit gains/loses $1 per $1 price move.
 * This is an estimate, not a broker contract-specification lookup.
 */
export function calculatePositionSize({ balance, riskPercent = 1, entry, stopLoss }) {
  if (![balance, riskPercent, entry, stopLoss].every(Number.isFinite) ||
      balance <= 0 || riskPercent <= 0 || riskPercent > 2 ||
      entry <= 0 || stopLoss <= 0 || entry === stopLoss) return null;
  const riskAmountUsd = balance * (riskPercent / 100);
  const stopDistance = Math.abs(entry - stopLoss);
  const units = Math.floor(riskAmountUsd / stopDistance);
  if (!Number.isFinite(units) || units <= 0) return null;
  return {
    units,
    riskAmountUsd: Number(riskAmountUsd.toFixed(2)),
    stopDistance,
    riskPercent,
    assumptions: "USD account; USD-quoted instrument; excludes spread, commission, slippage and broker contract constraints"
  };
}
