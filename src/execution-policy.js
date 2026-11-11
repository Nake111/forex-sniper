const DIRECTIONS = new Set(["BUY", "SELL"]);

export const MARKET_EXECUTION_PROFILES = Object.freeze({
  EURUSD: { minTrendVotes: 2, minMomentumVotes: 2, minAdx: 14, maxAtrExpansion: 2.1, rsiBuy: 51, rsiSell: 49, stopAtr: 1.4, rewardRisk: 2.0, maxSpreadAtr: 0.12 },
  BTCUSD: { minTrendVotes: 2, minMomentumVotes: 3, minAdx: 16, maxAtrExpansion: 2.6, rsiBuy: 53, rsiSell: 47, stopAtr: 1.8, rewardRisk: 2.0, maxSpreadAtr: 0.18 },
  XAUUSD: { minTrendVotes: 2, minMomentumVotes: 3, minAdx: 16, maxAtrExpansion: 2.2, rsiBuy: 52, rsiSell: 48, stopAtr: 1.6, rewardRisk: 2.0, maxSpreadAtr: 0.15 }
});

const regimeSide = frame => frame?.regime === "BULL_TREND" ? "BUY" : frame?.regime === "BEAR_TREND" ? "SELL" : "HOLD";
const signSide = (value, side) => Number.isFinite(value) && (side === "BUY" ? value > 0 : value < 0);

export function evaluateDeterministicFallback(direction, market, frames, macro = {}, extraBlocks = []) {
  const profile = MARKET_EXECUTION_PROFILES[market];
  if (!profile) throw new Error("Unsupported market execution profile: " + market);
  const reasons = [];
  const blockers = [...extraBlocks];
  if (!DIRECTIONS.has(direction)) reasons.push("No directional technical candidate");
  if (macro.dataStale) blockers.push("Stale candle data");
  if (macro.eventRisk !== "NORMAL") blockers.push("Economic/news risk is " + (macro.eventRisk ?? "UNKNOWN"));

  const { M5 = {}, M15 = {}, H1 = {} } = frames ?? {};
  const trendVotes = [M5, M15, H1].filter(frame => regimeSide(frame) === direction).length;
  const opposingTrendVotes = [M5, M15, H1].filter(frame => regimeSide(frame) !== "HOLD" && regimeSide(frame) !== direction).length;
  if (trendVotes < profile.minTrendVotes) reasons.push("Trend alignment " + trendVotes + "/3; requires " + profile.minTrendVotes);
  if (opposingTrendVotes > 0) reasons.push("Opposing timeframe trend detected (" + opposingTrendVotes + ")");

  const momentumChecks = [
    signSide(M5.macdHistogram, direction),
    signSide(M15.macdHistogram, direction),
    direction === "BUY" ? Number.isFinite(M5.rsi14) && M5.rsi14 >= profile.rsiBuy
      : Number.isFinite(M5.rsi14) && M5.rsi14 <= profile.rsiSell,
    M5.supertrend?.direction === (direction === "BUY" ? "BULLISH" : "BEARISH"),
    direction === "BUY" ? Number.isFinite(M5.cci20) && M5.cci20 > 0
      : Number.isFinite(M5.cci20) && M5.cci20 < 0,
    M5.roc?.direction === (direction === "BUY" ? "BULLISH" : "BEARISH")
  ];
  const momentumVotes = momentumChecks.filter(Boolean).length;
  if (momentumVotes < profile.minMomentumVotes) reasons.push("Momentum confirmations " + momentumVotes + "/" + momentumChecks.length + "; requires " + profile.minMomentumVotes);

  const atrRatio = Number.isFinite(M5.atr14) && Number.isFinite(M5.atrBaseline) && M5.atrBaseline > 0
    ? M5.atr14 / M5.atrBaseline : null;
  if (atrRatio !== null && atrRatio > profile.maxAtrExpansion) blockers.push("ATR expansion " + atrRatio.toFixed(2) + " exceeds " + profile.maxAtrExpansion.toFixed(2));
  if (Number.isFinite(M5.adx14) && M5.adx14 < profile.minAdx) reasons.push("M5 ADX " + M5.adx14.toFixed(1) + " below market threshold " + profile.minAdx);

  const candle = M5.lastCandle;
  const candleValid = candle && [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) && candle.high > candle.low;
  const closePosition = candleValid ? (candle.close - candle.low) / (candle.high - candle.low) : null;
  const candleAligned = candleValid && (direction === "BUY"
    ? candle.close > candle.open && closePosition >= 0.60
    : candle.close < candle.open && closePosition <= 0.40);
  if (!candleAligned) reasons.push("M5 trigger candle is not confirmed in the candidate direction");

  const spread = Number.isFinite(M5.spread) ? M5.spread
    : Number.isFinite(M5.lastCandle?.spread) ? M5.lastCandle.spread : null;
  const spreadAtr = spread !== null && Number.isFinite(M5.atr14) && M5.atr14 > 0 ? spread / M5.atr14 : null;
  if (spreadAtr !== null && spreadAtr > profile.maxSpreadAtr) {
    blockers.push("Spread/ATR " + spreadAtr.toFixed(3) + " exceeds " + profile.maxSpreadAtr.toFixed(3));
  }
  const approved = DIRECTIONS.has(direction) && reasons.length === 0 && blockers.length === 0;
  return {
    market, direction, approved, profile,
    trendVotes, opposingTrendVotes, momentumVotes, atrRatio, spreadAtr,
    spreadStatus: spreadAtr === null ? "UNAVAILABLE — broker bid/ask spread is not connected" : "AVAILABLE",
    reasons: [...blockers, ...reasons],
    reason: approved ? "Deterministic fallback passed market-specific trend, momentum, volatility and candle checks"
      : [...blockers, ...reasons].join("; ") || "Deterministic fallback not approved"
  };
}
