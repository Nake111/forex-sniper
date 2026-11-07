export function classifyMarketRegime({ close, ema50, ema200, adx14, atr14, atrBaseline }) {
  if (![close, ema50, ema200].every(Number.isFinite)) return "UNKNOWN";
  const trend = close > ema50 && ema50 > ema200 ? "BULL_TREND"
    : close < ema50 && ema50 < ema200 ? "BEAR_TREND" : "RANGE";
  if (Number.isFinite(adx14) && adx14 < 16) return "LOW_TREND_RANGE";
  if (Number.isFinite(atr14) && Number.isFinite(atrBaseline) && atrBaseline > 0 && atr14 > atrBaseline * 1.8) return "HIGH_VOLATILITY";
  return trend;
}
