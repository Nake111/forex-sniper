const valid = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

/**
 * Independent research adaptation of the public README's stated approach:
 * ATR expansion + multi-period price acceleration aligned with trend.
 * No MT4 binary/source is copied; upstream repository publishes README only.
 */
export function evaluateAlphaPipResearch(candles, {
  atr14 = null,
  atrBaseline = null,
  ema20 = null,
  ema50 = null,
  momentumPeriods = [5, 12, 24],
  minimumAligned = 2,
  minimumAtrExpansion = 1.1
} = {}) {
  const unavailable = {
    status: "UNAVAILABLE", direction: "NONE", trend: "UNAVAILABLE",
    atrRatio: null, volatilityExpanded: false, momentum: [],
    alignedMomentum: 0, requiredMomentum: minimumAligned,
    researchOnly: true, voteWeight: 0, canApproveSignal: false
  };
  if (!Array.isArray(candles) || !candles.length ||
      !Array.isArray(momentumPeriods) || momentumPeriods.length === 0 ||
      !Number.isInteger(minimumAligned) || minimumAligned < 1 || minimumAligned > momentumPeriods.length ||
      !valid(minimumAtrExpansion) || Number(minimumAtrExpansion) <= 0 ||
      momentumPeriods.some(p => !Number.isInteger(p) || p < 1) ||
      candles.length <= Math.max(...momentumPeriods) ||
      ![atr14, atrBaseline, ema20, ema50].every(valid) ||
      Number(atrBaseline) <= 0 || Number(atr14) <= 0) return unavailable;

  const close = Number(candles.at(-1).close);
  if (!Number.isFinite(close)) return unavailable;
  const trend = close > Number(ema20) && Number(ema20) > Number(ema50) ? "BULLISH"
    : close < Number(ema20) && Number(ema20) < Number(ema50) ? "BEARISH" : "NEUTRAL";
  const momentum = momentumPeriods.map(period => {
    const prior = Number(candles.at(-1 - period).close);
    const value = prior !== 0 ? 100 * (close - prior) / prior : null;
    return {
      period,
      value: Number.isFinite(value) ? value : null,
      direction: !Number.isFinite(value) ? "UNAVAILABLE"
        : value > 0 ? "BULLISH" : value < 0 ? "BEARISH" : "NEUTRAL"
    };
  });
  const atrRatio = Number(atr14) / Number(atrBaseline);
  const volatilityExpanded = atrRatio >= minimumAtrExpansion;
  const alignedMomentum = momentum.filter(item => item.direction === trend && ["BULLISH", "BEARISH"].includes(trend)).length;
  const direction = volatilityExpanded && trend !== "NEUTRAL" && alignedMomentum >= minimumAligned ? trend : "NONE";
  const status = direction !== "NONE" ? "ALIGNED_MOMENTUM_CANDIDATE"
    : !volatilityExpanded ? "LOW_VOLATILITY_WATCH"
      : trend === "NEUTRAL" ? "NO_CLEAR_TREND"
        : "MOMENTUM_NOT_ALIGNED";
  return {
    status, direction, trend, atrRatio, volatilityExpanded, minimumAtrExpansion,
    momentum, alignedMomentum, requiredMomentum: minimumAligned,
    note: "ATR expansion and multi-period ROC are research annotations, not a verified MT4 reproduction or a trade approval.",
    researchOnly: true, voteWeight: 0, canApproveSignal: false
  };
}
