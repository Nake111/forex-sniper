const DEFAULT_COVERAGE_TOLERANCE_MS = 3 * 24 * 60 * 60_000;

export function findHistoricalCoverageGap(candles, cutoff, toleranceMs = DEFAULT_COVERAGE_TOLERANCE_MS) {
  if (!Number.isFinite(cutoff) || !Number.isFinite(toleranceMs) || toleranceMs < 0) {
    throw new Error("Invalid historical coverage boundary");
  }
  const times = (Array.isArray(candles) ? candles : [])
    .map(candle => Number(candle.timestamp ?? candle.time))
    .filter(Number.isFinite);
  if (!times.length) return { from: cutoff, to: null, reason: "NO_CANDLES" };
  const earliest = Math.min(...times);
  return earliest > cutoff + toleranceMs
    ? { from: cutoff, to: earliest - 1, earliest, reason: "INCOMPLETE_HISTORY" }
    : null;
}
