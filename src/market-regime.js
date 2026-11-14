const finite = Number.isFinite;

/**
 * Closed-candle market regime classifier. ABNORMAL is a hard research warning;
 * it must never be interpreted as a directional signal.
 */
export function classifyMarketRegime({ close, ema20, ema50, ema200, adx14, atr14, atrBaseline, candleRange, rangeBaseline }) {
  if (![close, ema50, ema200].every(finite)) return "UNKNOWN";
  if ((finite(atr14) && finite(atrBaseline) && atrBaseline > 0 && atr14 / atrBaseline >= 3) ||
      (finite(candleRange) && finite(rangeBaseline) && rangeBaseline > 0 && candleRange / rangeBaseline >= 4)) return "ABNORMAL";
  if (finite(atr14) && finite(atrBaseline) && atrBaseline > 0 && atr14 / atrBaseline >= 1.8) return "HIGH_VOLATILITY";
  if (finite(adx14) && adx14 < 16) return "LOW_TREND_RANGE";
  if (close > ema50 && ema50 > ema200 && (!finite(ema20) || ema20 >= ema50)) return "BULL_TREND";
  if (close < ema50 && ema50 < ema200 && (!finite(ema20) || ema20 <= ema50)) return "BEAR_TREND";
  return "RANGE";
}
