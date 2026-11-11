const finite = Number.isFinite;
const priceOf = candle => (Number(candle.high) + Number(candle.low) + Number(candle.close)) / 3;
const timestampOf = candle => {
  const raw = candle.timestamp ?? candle.time ?? candle.date;
  const value = typeof raw === "number" ? raw : Date.parse(raw);
  return finite(value) ? (value < 1e12 ? value * 1000 : value) : NaN;
};
const side = value => value === "BULLISH" ? "BUY" : value === "BEARISH" ? "SELL" : "HOLD";

export function calculateSessionVWAP(candles) {
  if (!Array.isArray(candles) || !candles.length) return { available: false, reason: "No candles" };
  const lastTime = timestampOf(candles.at(-1));
  if (!finite(lastTime)) return { available: false, reason: "Invalid candle timestamp" };
  const day = new Date(lastTime).toISOString().slice(0, 10);
  const session = candles.filter(c => {
    const time = timestampOf(c);
    return finite(time) && new Date(time).toISOString().slice(0, 10) === day;
  });
  if (session.some(c => ![c.high, c.low, c.close, c.volume].every(v => finite(Number(v))) ||
      Number(c.high) < Number(c.low) || Number(c.volume) < 0)) {
    return { available: false, reason: "Invalid OHLCV in current session" };
  }
  const totalVolume = session.reduce((sum, c) => sum + Number(c.volume), 0);
  if (!(totalVolume > 0)) return { available: false, reason: "No usable volume; VWAP unavailable" };
  const weighted = session.reduce((sum, c) => sum + priceOf(c) * Number(c.volume), 0);
  const vwap = weighted / totalVolume;
  const variance = session.reduce((sum, c) => sum + Number(c.volume) * (priceOf(c) - vwap) ** 2, 0) / totalVolume;
  return {
    available: true, anchor: "UTC_DAY", sessionDate: day, candles: session.length,
    totalVolume, vwap, deviation: Math.sqrt(Math.max(0, variance)),
    upper1: vwap + Math.sqrt(Math.max(0, variance)),
    lower1: vwap - Math.sqrt(Math.max(0, variance)),
    upper2: vwap + 2 * Math.sqrt(Math.max(0, variance)),
    lower2: vwap - 2 * Math.sqrt(Math.max(0, variance))
  };
}

function volumeExpansion(candles, lookback = 20, multiplier = 1.1) {
  if (candles.length < lookback + 1) return false;
  const current = Number(candles.at(-1).volume);
  const prior = candles.slice(-lookback - 1, -1).map(c => Number(c.volume));
  if (!finite(current) || prior.some(v => !finite(v)) || prior.some(v => v < 0)) return false;
  const average = prior.reduce((a, b) => a + b, 0) / prior.length;
  return average > 0 && current >= average * multiplier;
}

function result(name, signal, reason, extra = {}) {
  return { name, signal, reason, ...extra };
}

/**
 * Five independent VWAP setups. This module is deliberately advisory:
 * its outputs are reported separately and never override the main signal engine.
 */
export function evaluateVWAPStrategies({ candles, M5, M15, H1, market = "UNKNOWN" }) {
  const empty = name => result(name, "HOLD", "Insufficient or invalid VWAP data");
  if (!Array.isArray(candles) || candles.length < 25) {
    return { sessionVWAP: { available: false, reason: "Need at least 25 candles" },
      strategies: ["RECLAIM_BREAKDOWN", "PULLBACK_CONTINUATION", "DEVIATION_MEAN_REVERSION", "LIQUIDITY_SWEEP", "SESSION_BREAKOUT"].map(empty) };
  }
  const sessionVWAP = calculateSessionVWAP(candles);
  const names = ["RECLAIM_BREAKDOWN", "PULLBACK_CONTINUATION", "DEVIATION_MEAN_REVERSION", "LIQUIDITY_SWEEP", "SESSION_BREAKOUT"];
  if (!sessionVWAP.available) return { sessionVWAP, strategies: names.map(name => result(name, "HOLD", sessionVWAP.reason)) };

  const current = candles.at(-1), previous = candles.at(-2);
  const close = Number(current.close), prevClose = Number(previous.close);
  const high = Number(current.high), low = Number(current.low);
  const open = Number(current.open), atr = Number(M5?.atr14);
  const adx = Number(M5?.adx14);
  const vwap = sessionVWAP.vwap;
  const expansion = volumeExpansion(candles);
  const vwapRising = priceOf(current) >= priceOf(previous) || close > prevClose;
  const m15Bull = M15?.close > M15?.vwap && M15?.regime !== "BEAR_TREND";
  const m15Bear = M15?.close < M15?.vwap && M15?.regime !== "BULL_TREND";
  const h1Bull = H1?.regime === "BULL_TREND" || H1?.close > H1?.ema50;
  const h1Bear = H1?.regime === "BEAR_TREND" || H1?.close < H1?.ema50;
  const bullishCandle = close > open, bearishCandle = close < open;
  const validAtr = finite(atr) && atr > 0;

  const reclaim = close > vwap && prevClose <= vwap && bullishCandle && expansion && vwapRising
    ? "BUY" : close < vwap && prevClose >= vwap && bearishCandle && expansion && !vwapRising ? "SELL" : "HOLD";
  const reclaimResult = result("RECLAIM_BREAKDOWN", reclaim,
    reclaim === "HOLD" ? "Requires a confirmed VWAP cross, directional close and volume expansion" : "Confirmed VWAP cross with volume expansion",
    { volumeExpansion: expansion });

  const nearVWAP = validAtr && Math.abs(close - vwap) <= atr * 0.25;
  const pullback = nearVWAP && finite(adx) && adx >= 18 && bullishCandle && M5?.regime === "BULL_TREND" && m15Bull && h1Bull
    ? "BUY" : nearVWAP && finite(adx) && adx >= 18 && bearishCandle && M5?.regime === "BEAR_TREND" && m15Bear && h1Bear
      ? "SELL" : "HOLD";
  const pullbackResult = result("PULLBACK_CONTINUATION", pullback,
    pullback === "HOLD" ? "Requires VWAP retest within 0.25 ATR and M5/M15/H1 trend alignment" : "Trend-aligned VWAP retest and candle confirmation");

  const deviation = sessionVWAP.deviation;
  const meanReversion = finite(adx) && adx < 20 && deviation > 0 &&
    low <= sessionVWAP.lower2 && close > sessionVWAP.lower2 && bullishCandle ? "BUY"
      : finite(adx) && adx < 20 && deviation > 0 &&
        high >= sessionVWAP.upper2 && close < sessionVWAP.upper2 && bearishCandle ? "SELL" : "HOLD";
  const meanResult = result("DEVIATION_MEAN_REVERSION", meanReversion,
    meanReversion === "HOLD" ? "Requires a 2σ excursion, close back inside and ADX below 20" : "2σ rejection in a low-trend-strength regime",
    { adx, target: vwap, stopReference: "Signal candle extreme plus ATR buffer" });

  const sweepDirection = M5?.structure?.sweep ?? M5?.structure?.liquiditySweep;
  const sweep = sweepDirection === "BULLISH" && close > vwap && bullishCandle && m15Bull && h1Bull ? "BUY"
    : sweepDirection === "BEARISH" && close < vwap && bearishCandle && m15Bear && h1Bear ? "SELL" : "HOLD";
  const sweepResult = result("LIQUIDITY_SWEEP", sweep,
    sweep === "HOLD" ? "Requires detected liquidity sweep, VWAP-side close and higher-timeframe confirmation" : "Liquidity sweep reclaimed/rejected VWAP with higher-timeframe alignment");

  const breakout = M5?.sessionContext?.breakout ?? M5?.sessionContext?.sessionRangeBreakout;
  const sessionBreakout = breakout === "BULLISH" && close > vwap && bullishCandle && expansion && m15Bull && h1Bull ? "BUY"
    : breakout === "BEARISH" && close < vwap && bearishCandle && expansion && m15Bear && h1Bear ? "SELL" : "HOLD";
  const breakoutResult = result("SESSION_BREAKOUT", sessionBreakout,
    sessionBreakout === "HOLD" ? "Requires session-range break, VWAP alignment, volume expansion and M15/H1 confirmation" : "Session breakout confirmed above/below VWAP with volume");

  return {
    market, sessionVWAP,
    volumeType: ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD"].includes(market) ? "BROKER_TICK_VOLUME_PROXY" : "VENUE_OR_FEED_VOLUME",
    strategies: [reclaimResult, pullbackResult, meanResult, sweepResult, breakoutResult]
  };
}


/**
 * VWAP is the primary directional provider. Require at least two independent
 * strategy confirmations and a two-vote margin; disagreement or thin evidence
 * returns HOLD. The caller retains all existing data/news/agent safety gates.
 */
export function selectVWAPConsensus(report) {
  const strategies = report?.strategies ?? [];
  const buys = strategies.filter(item => item.signal === "BUY").length;
  const sells = strategies.filter(item => item.signal === "SELL").length;
  const gap = Math.abs(buys - sells);
  const signal = buys >= 2 && buys - sells >= 2 ? "BUY"
    : sells >= 2 && sells - buys >= 2 ? "SELL" : "HOLD";
  return {
    signal, buys, sells, gap, requiredVotes: 2,
    reason: signal === "HOLD"
      ? "VWAP consensus not reached: need at least two strategy confirmations and a two-vote directional margin"
      : `${signal} confirmed by ${signal === "BUY" ? buys : sells} of five VWAP strategies`
  };
}
