/**
 * GitHub research integrations for Forex Sniper.
 *
 * Original, transparent JavaScript adapters inspired by public methodology
 * descriptions from hpFX, ICT/SMC Forex Research, FxTT Scanner, Gann/Hurst,
 * and FX Strategy Framework. This is NOT a port of their proprietary or
 * platform-specific source. All modules are research-only and have zero
 * signal weight until independently validated on training data and forward
 * paper observations. The final 30% chronological holdout is never used here.
 *
 * Closed candles only. No centered/future-looking moving averages.
 */

const DIRECTIONAL = new Set(["BUY", "SELL"]);

function finite(value) {
  return Number.isFinite(Number(value));
}

function sideFromDelta(delta, epsilon = 0) {
  if (!finite(delta) || Math.abs(delta) <= epsilon) return "NEUTRAL";
  return delta > 0 ? "BUY" : "SELL";
}

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.every(finite) ? slice.reduce((sum, value) => sum + value, 0) / period : null;
}

function confirmedSwings(candles, left = 2, right = 2) {
  const highs = [], lows = [];
  for (let i = left; i < candles.length - right; i++) {
    const window = candles.slice(i - left, i + right + 1);
    const high = candles[i].high, low = candles[i].low;
    if (window.every((c, j) => j === left || high > c.high)) highs.push({ index: i, price: high });
    if (window.every((c, j) => j === left || low < c.low)) lows.push({ index: i, price: low });
  }
  return { highs, lows };
}

function smcResearch(candles) {
  const swings = confirmedSwings(candles);
  const last = candles.at(-1);
  const priorHigh = [...swings.highs].reverse().find(p => p.index < candles.length - 1);
  const priorLow = [...swings.lows].reverse().find(p => p.index < candles.length - 1);
  const mss = priorHigh && last.close > priorHigh.price ? "BUY"
    : priorLow && last.close < priorLow.price ? "SELL" : "NEUTRAL";

  let fvg = null;
  for (let i = candles.length - 1; i >= Math.max(2, candles.length - 12); i--) {
    const a = candles[i - 2], c = candles[i];
    if (c.low > a.high) { fvg = { direction: "BUY", lower: a.high, upper: c.low, index: i }; break; }
    if (c.high < a.low) { fvg = { direction: "SELL", lower: c.high, upper: a.low, index: i }; break; }
  }
  const fvgOpen = fvg && (fvg.direction === "BUY" ? last.close > fvg.upper : last.close < fvg.lower);
  const direction = DIRECTIONAL.has(mss) && fvgOpen && fvg.direction === mss ? mss : "NEUTRAL";
  return { status: "RESEARCH_ONLY", mss, fvg, fvgOpen: Boolean(fvgOpen), direction, swingHigh: priorHigh?.price ?? null, swingLow: priorLow?.price ?? null };
}

function hpfxRoleResearch(frames) {
  const rows = ["M5", "M15", "H1", "H4"].map(tf => ({ tf, frame: frames[tf] })).filter(x => x.frame);
  const votes = rows.map(({ tf, frame }) => {
    const direction = finite(frame.ema20) && finite(frame.ema50)
      ? sideFromDelta(frame.ema20 - frame.ema50) : "NEUTRAL";
    const confirmation = finite(frame.macd) && finite(frame.macdSignal)
      ? sideFromDelta(frame.macd - frame.macdSignal) : "NEUTRAL";
    const tradeOrNot = finite(frame.atr14) && frame.atr14 > 0 &&
      (!finite(frame.adx14) || frame.adx14 >= 15);
    return { timeframe: tf, signalRole: direction, confirmationRole: confirmation, tradeOrNotRole: tradeOrNot };
  });
  const latest = votes.find(v => v.timeframe === "M5");
  const confirmations = votes.filter(v => v.timeframe !== "M5" && v.confirmationRole === latest?.signalRole).length;
  const direction = latest && DIRECTIONAL.has(latest.signalRole) && latest.tradeOrNotRole && confirmations >= 1
    ? latest.signalRole : "NEUTRAL";
  return { status: "RESEARCH_ONLY", roles: ["TRADEORNOT", "SIGNAL", "CONFIRMATION", "EXIT"], votes, direction, confirmationCount: confirmations };
}

function scannerResearch(m5, quoteValidation) {
  const spreadAtr = finite(quoteValidation?.spread) && finite(m5?.atr14) && m5.atr14 > 0
    ? quoteValidation.spread / m5.atr14 : null;
  const spreadPass = quoteValidation?.valid === true && finite(spreadAtr) && spreadAtr <= 0.12;
  const adxPass = finite(m5?.adx14) && m5.adx14 >= 18;
  const rsiDirection = finite(m5?.rsi14) ? (m5.rsi14 >= 55 ? "BUY" : m5.rsi14 <= 45 ? "SELL" : "NEUTRAL") : "NEUTRAL";
  const trendDirection = finite(m5?.ema20) && finite(m5?.ema50) ? sideFromDelta(m5.ema20 - m5.ema50) : "NEUTRAL";
  const direction = spreadPass && adxPass && rsiDirection === trendDirection && DIRECTIONAL.has(trendDirection)
    ? trendDirection : "NEUTRAL";
  return { status: "RESEARCH_ONLY", spreadAtr, spreadPass, adx: m5?.adx14 ?? null, adxPass, rsi: m5?.rsi14 ?? null, rsiDirection, trendDirection, direction };
}

function gannHurstResearch(candles) {
  if (candles.length < 64) return { status: "INSUFFICIENT_HISTORY", direction: "NEUTRAL", signalWeight: 0 };
  const sample = candles.slice(-64);
  const high = Math.max(...sample.map(c => c.high));
  const low = Math.min(...sample.map(c => c.low));
  const range = high - low;
  if (!(range > 0)) return { status: "INVALID_RANGE", direction: "NEUTRAL", signalWeight: 0 };
  const octave = range / 8;
  const murrey = Array.from({ length: 9 }, (_, level) => ({ level: level + "/8", price: low + octave * level }));
  const swings = confirmedSwings(candles);
  const pivot = [...swings.lows].at(-1) ?? [...swings.highs].at(-1);
  const barsFromPivot = pivot ? candles.length - 1 - pivot.index : null;
  // 1x1/2x1 are normalized to 1/8 octave per 8 bars, not screen pixels.
  const gann1x1 = pivot ? pivot.price + (pivot.price === candles[pivot.index].low ? 1 : -1) * (octave / 8) * barsFromPivot : null;
  const gann2x1 = pivot ? pivot.price + (pivot.price === candles[pivot.index].low ? 1 : -1) * (octave / 4) * barsFromPivot : null;
  const closes = candles.map(c => c.close);
  const ma32 = sma(closes, 32), ma64 = sma(closes, 64), ma128 = sma(closes, 128);
  const aligned = [ma32, ma64, ma128].every(finite);
  const direction = aligned && ma32 > ma64 && ma64 > ma128 ? "BUY"
    : aligned && ma32 < ma64 && ma64 < ma128 ? "SELL" : "NEUTRAL";
  return {
    status: "RESEARCH_ONLY_NO_CENTRED_MA",
    direction,
    murreyOctave: { low, high, levels: murrey },
    gann: { anchor: pivot ?? null, barsFromPivot, normalized1x1: gann1x1, normalized2x1: gann2x1 },
    trailingHurstProxy: { ma32, ma64, ma128, aligned },
    timingCycles: "NOT_AUTOMATED — no astronomy/cycle timing claim"
  };
}

function validationFramework(candles) {
  const count = candles.length;
  const trainEnd = Math.floor(count * 0.7);
  return {
    status: count >= 100 ? "TRAINING_WINDOW_ONLY" : "INSUFFICIENT_HISTORY",
    totalClosedCandles: count,
    trainingRange: { startIndex: 0, endIndexExclusive: trainEnd, count: trainEnd },
    holdoutRange: { startIndex: trainEnd, endIndexExclusive: count, count: count - trainEnd },
    holdoutAccess: "LOCKED_UNTIL_CANDIDATE_SETTINGS_FROZEN",
    requiredValidation: ["chronological walk-forward", "realistic spread/commission/slippage", "minimum 30 resolved trades", "forward paper test"],
    optimizationApplied: false,
    signalWeight: 0
  };
}

export function evaluateGithubResearchIntegrations({ frames, candles, quoteValidation = null }) {
  const hpfx = hpfxRoleResearch(frames);
  const smc = smcResearch(candles);
  const scanner = scannerResearch(frames.M5, quoteValidation);
  const gannHurst = gannHurstResearch(candles);
  const framework = validationFramework(candles);
  return {
    generatedAt: new Date().toISOString(),
    mode: "PAPER_RESEARCH_ONLY",
    primaryProvider: "FOREX_SNIPER",
    modules: { hpfx, forexResearch: smc, fxttScanner: scanner, gannHurst, fxStrategyFramework: framework },
    governance: {
      externalModuleSignalWeight: 0,
      mayApproveTrade: false,
      mayOverridePrimaryProvider: false,
      closedCandlesOnly: true,
      holdoutProtected: true,
      note: "Research diagnostics only. No external module changes BUY/SELL approval."
    }
  };
}
