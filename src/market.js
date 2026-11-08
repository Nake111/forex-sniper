import { analyzeMarketStructure } from "./market-structure.js";
import { analyzeSmartMoney } from "./smart-money.js";
import { calculateVolumeProfile } from "./volume-profile.js";
import { classifyMarketRegime } from "./market-regime.js";
import { getSessionContext } from "./sessions.js";

export function ema(values, period) {
  if (values.length < period) return null;
  const multiplier = 2 / (period + 1);
  let result = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) result = (values[i] - result) * multiplier + result;
  return result;
}

export function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function emaSeries(values, period) {
  const output = Array(values.length).fill(null);
  if (values.length < period) return output;
  const multiplier = 2 / (period + 1);
  let result = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  output[period - 1] = result;
  for (let i = period; i < values.length; i++) {
    result = (values[i] - result) * multiplier + result;
    output[i] = result;
  }
  return output;
}

export function macd(values) {
  const fast = emaSeries(values, 12);
  const slow = emaSeries(values, 26);
  const line = fast.map((value, i) => value === null || slow[i] === null ? null : value - slow[i]);
  const valid = line.filter(value => value !== null);
  const signal = emaSeries(valid, 9).at(-1);
  const current = line.at(-1);
  return { line: current, signal, histogram: current !== null && signal !== null ? current - signal : null };
}

export function adx(candles, period = 14) {
  if (!Array.isArray(candles) || !Number.isInteger(period) || period < 2 || candles.length < period * 2 + 1) return null;
  const tr = [];
  const plusDM = [];
  const minusDM = [];
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];
    const upMove = Number(current.high) - Number(previous.high);
    const downMove = Number(previous.low) - Number(current.low);
    tr.push(Math.max(Number(current.high) - Number(current.low), Math.abs(Number(current.high) - Number(previous.close)), Math.abs(Number(current.low) - Number(previous.close))));
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  let trSmooth = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let plusSmooth = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let minusSmooth = minusDM.slice(0, period).reduce((a, b) => a + b, 0);
  const dx = [];
  for (let i = period - 1; i < tr.length; i++) {
    if (i > period - 1) {
      trSmooth = trSmooth - trSmooth / period + tr[i];
      plusSmooth = plusSmooth - plusSmooth / period + plusDM[i];
      minusSmooth = minusSmooth - minusSmooth / period + minusDM[i];
    }
    if (trSmooth <= 0) { dx.push(0); continue; }
    const plusDI = 100 * plusSmooth / trSmooth;
    const minusDI = 100 * minusSmooth / trSmooth;
    const denominator = plusDI + minusDI;
    dx.push(denominator > 0 ? 100 * Math.abs(plusDI - minusDI) / denominator : 0);
  }
  if (dx.length < period) return null;
  let value = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dx.length; i++) value = (value * (period - 1) + dx[i]) / period;
  return value;
}

export function atr(candles, period = 14) {
  if (candles.length <= period) return null;
  const ranges = [];
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];
    ranges.push(Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close)));
  }
  return ranges.slice(-period).reduce((a, b) => a + b, 0) / period;
}

export function squeezeMomentum(candles, length = 20, bbMult = 2, kcMult = 1.5) {
  if (!Array.isArray(candles) || candles.length < length + 1) {
    return { state: "INSUFFICIENT_DATA", momentum: null, previousMomentum: null, direction: "N/A" };
  }
  const sma = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const closes = candles.map(c => Number(c.close));
  const trueRanges = candles.map((candle, i) => {
    if (i === 0) return Number(candle.high) - Number(candle.low);
    const previousClose = closes[i - 1];
    return Math.max(Number(candle.high) - Number(candle.low), Math.abs(Number(candle.high) - previousClose), Math.abs(Number(candle.low) - previousClose));
  });
  function calculateAt(end) {
    const start = end - length + 1;
    const closeWindow = closes.slice(start, end + 1);
    const highWindow = candles.slice(start, end + 1).map(c => Number(c.high));
    const lowWindow = candles.slice(start, end + 1).map(c => Number(c.low));
    const basis = sma(closeWindow);
    const variance = closeWindow.reduce((sum, value) => sum + (value - basis) ** 2, 0) / length;
    const deviation = Math.sqrt(variance);
    const upperBB = basis + bbMult * deviation;
    const lowerBB = basis - bbMult * deviation;
    const rangeMean = sma(trueRanges.slice(start, end + 1));
    const upperKC = basis + kcMult * rangeMean;
    const lowerKC = basis - kcMult * rangeMean;
    const squeezeOn = lowerBB > lowerKC && upperBB < upperKC;
    const squeezeOff = lowerBB < lowerKC && upperBB > upperKC;
    const highest = Math.max(...highWindow);
    const lowest = Math.min(...lowWindow);
    const anchor = ((highest + lowest) / 2 + basis) / 2;
    const regressionInput = closeWindow.map(value => value - anchor);
    const xMean = (length - 1) / 2;
    const yMean = sma(regressionInput);
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < length; i++) {
      numerator += (i - xMean) * (regressionInput[i] - yMean);
      denominator += (i - xMean) ** 2;
    }
    const slope = denominator === 0 ? 0 : numerator / denominator;
    const momentum = yMean + slope * (length - 1 - xMean);
    return { state: squeezeOn ? "SQUEEZE_ON" : squeezeOff ? "SQUEEZE_RELEASED" : "NO_SQUEEZE", momentum };
  }
  const current = calculateAt(candles.length - 1);
  const previous = calculateAt(candles.length - 2);
  let direction = "FLAT";
  if (current.momentum > 0) direction = current.momentum > previous.momentum ? "BULLISH_STRENGTHENING" : "BULLISH_WEAKENING";
  else if (current.momentum < 0) direction = current.momentum < previous.momentum ? "BEARISH_STRENGTHENING" : "BEARISH_WEAKENING";
  return { ...current, previousMomentum: previous.momentum, direction };
}



function rollingMean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function midpoint(candles, period) {
  if (candles.length < period) return null;
  const window = candles.slice(-period);
  return (Math.max(...window.map(c => Number(c.high))) + Math.min(...window.map(c => Number(c.low)))) / 2;
}

// Ichimoku current, unshifted cloud values; no future displacement is used in signals.
export function ichimoku(candles) {
  if (!Array.isArray(candles) || candles.length < 52) return { direction: "UNAVAILABLE", tenkan: null, kijun: null, cloudA: null, cloudB: null };
  const tenkan = midpoint(candles, 9);
  const kijun = midpoint(candles, 26);
  const cloudA = (tenkan + kijun) / 2;
  const cloudB = midpoint(candles, 52);
  const close = Number(candles.at(-1).close);
  const top = Math.max(cloudA, cloudB);
  const bottom = Math.min(cloudA, cloudB);
  const direction = close > top && tenkan > kijun ? "BULLISH" : close < bottom && tenkan < kijun ? "BEARISH" : "NEUTRAL";
  return { tenkan, kijun, cloudA, cloudB, cloudTop: top, cloudBottom: bottom, direction };
}

// Wilder-style ATR proxy plus recursively updated final Supertrend band.
export function supertrend(candles, period = 10, multiplier = 3) {
  if (!Array.isArray(candles) || candles.length < period + 2) return { value: null, direction: "UNAVAILABLE" };
  const trs = candles.map((c, i) => i === 0 ? Number(c.high) - Number(c.low) :
    Math.max(Number(c.high) - Number(c.low), Math.abs(Number(c.high) - Number(candles[i - 1].close)), Math.abs(Number(c.low) - Number(candles[i - 1].close))));
  let atrValue = rollingMean(trs.slice(1, period + 1));
  let upper = (Number(candles[period].high) + Number(candles[period].low)) / 2 + multiplier * atrValue;
  let lower = (Number(candles[period].high) + Number(candles[period].low)) / 2 - multiplier * atrValue;
  let direction = 1;
  for (let i = period + 1; i < candles.length; i++) {
    atrValue = (atrValue * (period - 1) + trs[i]) / period;
    const hl2 = (Number(candles[i].high) + Number(candles[i].low)) / 2;
    const basicUpper = hl2 + multiplier * atrValue;
    const basicLower = hl2 - multiplier * atrValue;
    const previousClose = Number(candles[i - 1].close);
    upper = basicUpper < upper || previousClose > upper ? basicUpper : upper;
    lower = basicLower > lower || previousClose < lower ? basicLower : lower;
    const close = Number(candles[i].close);
    if (direction === 1 && close < lower) direction = -1;
    else if (direction === -1 && close > upper) direction = 1;
  }
  return { value: direction === 1 ? lower : upper, direction: direction === 1 ? "BULLISH" : "BEARISH", atr: atrValue };
}

export function moneyFlowIndex(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  let positive = 0, negative = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const current = candles[i], previous = candles[i - 1];
    const typical = (Number(current.high) + Number(current.low) + Number(current.close)) / 3;
    const priorTypical = (Number(previous.high) + Number(previous.low) + Number(previous.close)) / 3;
    const flow = typical * Math.max(0, Number(current.volume) || 0);
    if (typical > priorTypical) positive += flow;
    else if (typical < priorTypical) negative += flow;
  }
  if (positive === 0 && negative === 0) return 50;
  if (negative === 0) return 100;
  if (positive === 0) return 0;
  return 100 - 100 / (1 + positive / negative);
}

export function commodityChannelIndex(candles, period = 20) {
  if (!Array.isArray(candles) || candles.length < period) return null;
  const window = candles.slice(-period).map(c => (Number(c.high) + Number(c.low) + Number(c.close)) / 3);
  const mean = rollingMean(window);
  const deviation = rollingMean(window.map(value => Math.abs(value - mean)));
  return deviation > 0 ? (window.at(-1) - mean) / (0.015 * deviation) : 0;
}

export function marketStructure(candles) {
  const structure = analyzeMarketStructure(candles, 3);
  return { ...structure, sweep: structure.sweepConfirmed ? structure.liquiditySweep : "NONE" };
}

export function rollingVwap(candles, period = 24) {
  if (!Array.isArray(candles) || candles.length < 1) return null;
  const window = candles.slice(-period);
  let pv = 0;
  let volume = 0;
  for (const candle of window) {
    const typical = (Number(candle.high) + Number(candle.low) + Number(candle.close)) / 3;
    const weight = Math.max(0, Number(candle.volume) || 0);
    pv += typical * weight;
    volume += weight;
  }
  return volume > 0 ? pv / volume : null;
}

export function cumulativeVolumeDeltaProxy(candles, slopeBars = 5) {
  if (!Array.isArray(candles) || candles.length < 2) return { value: null, recentDelta: null, slope: null, direction: "UNAVAILABLE" };
  const deltas = candles.map(candle => {
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    const volume = Math.max(0, Number(candle.volume) || 0);
    const range = high - low;
    if (!(range > 0) || !Number.isFinite(close)) return 0;
    return ((2 * close - high - low) / range) * volume;
  });
  const cumulative = [];
  deltas.reduce((sum, delta, index) => { cumulative[index] = sum + delta; return cumulative[index]; }, 0);
  const count = Math.min(slopeBars, cumulative.length - 1);
  const slope = cumulative.at(-1) - cumulative[cumulative.length - 1 - count];
  return {
    value: cumulative.at(-1),
    recentDelta: deltas.slice(-count).reduce((sum, value) => sum + value, 0),
    slope,
    direction: slope > 0 ? "BUYING" : slope < 0 ? "SELLING" : "FLAT"
  };
}

export function analyseTimeframe(candles) {
  if (!Array.isArray(candles) || candles.length < 60) throw new Error("Not enough candles for analysis.");
  const lastCandle = candles.at(-1);
  const sessionContext = getSessionContext(candles, { utcOffset: Number(process.env.SESSION_UTC_OFFSET ?? 0) });
  const closes = candles.map(c => Number(c.close));
  const close = closes.at(-1);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsi14 = rsi(closes, 14);
  const macdData = macd(closes);
  const atr14 = atr(candles, 14);
  const atrBaseline = candles.length > 30 ? atr(candles.slice(0, -14), 14) : null;
  const adx14 = adx(candles, 14);
  const profile = calculateVolumeProfile(candles, 24, 0.70);
  const vwap = rollingVwap(candles, 24);
  const cvd = cumulativeVolumeDeltaProxy(candles, 5);
  const structure = marketStructure(candles);
  const smartMoney = analyzeSmartMoney(candles);
  const squeeze = squeezeMomentum(candles);
  const supertrend14 = supertrend(candles, 10, 3);
  const ichimokuCloud = ichimoku(candles);
  const mfi14 = moneyFlowIndex(candles, 14);
  const cci20 = commodityChannelIndex(candles, 20);
  const regime = classifyMarketRegime({ close, ema50, ema200, adx14, atr14, atrBaseline });
  const bullish = [close > ema20, ema20 > ema50, rsi14 > 50, macdData.line > macdData.signal, supertrend14.direction === "BULLISH", ichimokuCloud.direction === "BULLISH", Number.isFinite(mfi14) && mfi14 > 50, Number.isFinite(cci20) && cci20 > 0];
  const bearish = [close < ema20, ema20 < ema50, rsi14 < 50, macdData.line < macdData.signal, supertrend14.direction === "BEARISH", ichimokuCloud.direction === "BEARISH", Number.isFinite(mfi14) && mfi14 < 50, Number.isFinite(cci20) && cci20 < 0];
  return {
    close, lastCandle: { timestamp: Number(lastCandle.timestamp ?? lastCandle.time), open: Number(lastCandle.open), high: Number(lastCandle.high), low: Number(lastCandle.low), close: Number(lastCandle.close) },
    sessionContext,
    ema20, ema50, ema200, regime, atrBaseline, rsi14, macd: macdData.line, macdSignal: macdData.signal,
    macdHistogram: macdData.histogram, atr14, adx14,
    supertrend: supertrend14, ichimoku: ichimokuCloud, mfi14, cci20,
    poc: profile.poc, valueAreaHigh: profile.valueAreaHigh, valueAreaLow: profile.valueAreaLow,
    profileVolume: profile.totalVolume, vwap, cvd, squeeze, structure, smartMoney,
    bullishVotes: bullish.filter(Boolean).length, bearishVotes: bearish.filter(Boolean).length,
    bullishConditions: bullish, bearishConditions: bearish
  };
}
