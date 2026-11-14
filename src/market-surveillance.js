const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

/**
 * Read-only market surveillance inspired by AI Profit Sniper's published
 * concepts: multi-factor scanning, volatility compression/release and
 * volume-confirmed breakouts. This module produces research annotations only.
 */
export function evaluateMarketSurveillance(candles, {
  atr14 = null,
  atrBaseline = null,
  squeeze = null,
  breakoutLookback = 20,
  volumeMultiplier = 1.5,
  expansionMultiplier = 1.1
} = {}) {
  const unavailable = {
    status: "UNAVAILABLE",
    direction: "NONE",
    breakout: "NONE",
    compression: "UNKNOWN",
    volatilityExpansion: false,
    atrRatio: null,
    volumeRatio: null,
    volumeStatus: "UNAVAILABLE",
    priorRangeHigh: null,
    priorRangeLow: null,
    researchOnly: true,
    voteWeight: 0,
    canApproveSignal: false
  };
  if (!Array.isArray(candles) || !Number.isInteger(breakoutLookback) ||
      breakoutLookback < 5 || candles.length < breakoutLookback + 1) return unavailable;

  const latest = candles.at(-1);
  const prior = candles.slice(-(breakoutLookback + 1), -1);
  if (![latest.open, latest.high, latest.low, latest.close].every(finite) ||
      prior.some(c => ![c.high, c.low, c.close].every(finite))) return unavailable;

  const priorRangeHigh = Math.max(...prior.map(c => Number(c.high)));
  const priorRangeLow = Math.min(...prior.map(c => Number(c.low)));
  const close = Number(latest.close);
  const breakout = close > priorRangeHigh ? "BULLISH"
    : close < priorRangeLow ? "BEARISH" : "NONE";

  const atrRatio = finite(atr14) && finite(atrBaseline) && Number(atrBaseline) > 0
    ? Number(atr14) / Number(atrBaseline) : null;
  const compression = squeeze?.previousState === "SQUEEZE_ON" && squeeze?.state === "SQUEEZE_RELEASED"
    ? "RELEASED"
    : squeeze?.state === "SQUEEZE_ON" || atrRatio !== null && atrRatio <= 0.8
      ? "COMPRESSION" : "NONE";
  const volatilityExpansion = compression === "RELEASED" ||
    atrRatio !== null && atrRatio >= expansionMultiplier;

  const latestVolume = Number(latest.volume);
  const priorVolumes = prior.map(c => Number(c.volume)).filter(v => Number.isFinite(v) && v > 0);
  const averageVolume = priorVolumes.length >= Math.ceil(breakoutLookback * 0.8)
    ? priorVolumes.reduce((sum, value) => sum + value, 0) / priorVolumes.length : null;
  const volumeRatio = averageVolume !== null && Number.isFinite(latestVolume) && latestVolume > 0
    ? latestVolume / averageVolume : null;
  const volumeStatus = volumeRatio === null ? "UNAVAILABLE"
    : volumeRatio >= volumeMultiplier ? "SURGE" : "NORMAL";

  const confirmed = breakout !== "NONE" && volatilityExpansion && volumeStatus === "SURGE";
  const status = confirmed ? "CONFIRMED_BREAKOUT_CANDIDATE"
    : breakout !== "NONE" ? "BREAKOUT_WATCH"
      : compression === "COMPRESSION" ? "COMPRESSION_WATCH" : "NO_SETUP";
  return {
    status,
    direction: confirmed ? breakout : "NONE",
    breakout,
    compression,
    volatilityExpansion,
    atrRatio,
    volumeRatio,
    volumeStatus,
    priorRangeHigh,
    priorRangeLow,
    breakoutLookback,
    volumeMultiplier,
    note: volumeStatus === "UNAVAILABLE"
      ? "No reliable candle-volume baseline; volume confirmation is unavailable."
      : "Volume is the feed-reported candle-volume field; for spot FX it may be tick volume, not centralized traded volume.",
    researchOnly: true,
    voteWeight: 0,
    canApproveSignal: false
  };
}
