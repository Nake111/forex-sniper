
import { analyzeMarketStructure } from "./market-structure.js";
import { analyzeSmartMoney } from "./smart-money.js";
import { calculateVolumeProfile } from "./volume-profile.js";

export function ema(values, period) {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);
  let result =
    values.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < values.length; i++) {
    result = (values[i] - result) * multiplier + result;
  }

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
  let result =
    values.slice(0, period).reduce((a, b) => a + b, 0) / period;

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

  const line = fast.map((value, i) =>
    value === null || slow[i] === null ? null : value - slow[i]
  );

  const valid = line.filter(value => value !== null);
  const signal = emaSeries(valid, 9).at(-1);
  const current = line.at(-1);

  return {
    line: current,
    signal,
    histogram:
      current !== null && signal !== null ? current - signal : null
  };
}

export function atr(candles, period = 14) {
  if (candles.length <= period) return null;

  const ranges = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    ranges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    ));
  }

  return ranges.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ==========================================
// TTM SQUEEZE MOMENTUM
// ==========================================

export function squeezeMomentum(
  candles,
  length = 20,
  bbMult = 2,
  kcMult = 1.5
) {
  if (!Array.isArray(candles) || candles.length < length + 1) {
    return {
      state: "INSUFFICIENT_DATA",
      momentum: null,
      previousMomentum: null,
      direction: "N/A"
    };
  }

  const sma = values =>
    values.reduce((sum, value) => sum + value, 0) / values.length;

  const closes = candles.map(c => Number(c.close));

  const trueRanges = candles.map((candle, i) => {
    if (i === 0) return Number(candle.high) - Number(candle.low);

    const previousClose = closes[i - 1];

    return Math.max(
      Number(candle.high) - Number(candle.low),
      Math.abs(Number(candle.high) - previousClose),
      Math.abs(Number(candle.low) - previousClose)
    );
  });

  function calculateAt(end) {
    const start = end - length + 1;
    const closeWindow = closes.slice(start, end + 1);

    const highWindow = candles
      .slice(start, end + 1)
      .map(c => Number(c.high));

    const lowWindow = candles
      .slice(start, end + 1)
      .map(c => Number(c.low));

    const basis = sma(closeWindow);

    const variance = closeWindow.reduce(
      (sum, value) => sum + (value - basis) ** 2,
      0
    ) / length;

    const deviation = Math.sqrt(variance);
    const upperBB = basis + bbMult * deviation;
    const lowerBB = basis - bbMult * deviation;

    const rangeMean = sma(trueRanges.slice(start, end + 1));
    const upperKC = basis + kcMult * rangeMean;
    const lowerKC = basis - kcMult * rangeMean;

    const squeezeOn =
      lowerBB > lowerKC && upperBB < upperKC;

    const squeezeOff =
      lowerBB < lowerKC && upperBB > upperKC;

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

    return {
      state: squeezeOn
        ? "SQUEEZE_ON"
        : squeezeOff
          ? "SQUEEZE_RELEASED"
          : "NO_SQUEEZE",
      momentum
    };
  }

  const current = calculateAt(candles.length - 1);
  const previous = calculateAt(candles.length - 2);

  let direction = "FLAT";

  if (current.momentum > 0) {
    direction = current.momentum > previous.momentum
      ? "BULLISH_STRENGTHENING"
      : "BULLISH_WEAKENING";
  } else if (current.momentum < 0) {
    direction = current.momentum < previous.momentum
      ? "BEARISH_STRENGTHENING"
      : "BEARISH_WEAKENING";
  }

  return {
    ...current,
    previousMomentum: previous.momentum,
    direction
  };
}

// ==========================================
// MARKET STRUCTURE
// ==========================================

export function marketStructure(candles) {
  const structure = analyzeMarketStructure(candles, 3);

  return {
    ...structure,
    sweep: structure.sweepConfirmed
      ? structure.liquiditySweep
      : "NONE"
  };
}

// ==========================================
 // ROLLING VWAP + CANDLE-BASED CVD PROXY
 // ==========================================

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
  // If the feed has no usable volume, do not fabricate a VWAP.
  return volume > 0 ? pv / volume : null;
}

export function cumulativeVolumeDeltaProxy(candles, slopeBars = 5) {
  if (!Array.isArray(candles) || candles.length < 2) {
    return { value: null, recentDelta: null, slope: null, direction: "UNAVAILABLE" };
  }
  const deltas = candles.map(candle => {
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    const volume = Math.max(0, Number(candle.volume) || 0);
    const range = high - low;
    if (!(range > 0) || !Number.isFinite(close)) return 0;
    // Estimates pressure from close location within each candle.
    // This is not exchange bid/ask aggressor delta.
    return ((2 * close - high - low) / range) * volume;
  });
  const cumulative = [];
  deltas.reduce((sum, delta, index) => {
    cumulative[index] = sum + delta;
    return cumulative[index];
  }, 0);
  const count = Math.min(slopeBars, cumulative.length - 1);
  const slope = cumulative.at(-1) - cumulative[cumulative.length - 1 - count];
  return {
    value: cumulative.at(-1),
    recentDelta: deltas.slice(-count).reduce((sum, value) => sum + value, 0),
    slope,
    direction: slope > 0 ? "BUYING" : slope < 0 ? "SELLING" : "FLAT"
  };
}

// ==========================================
// COMPLETE TIMEFRAME ANALYSIS
// ==========================================

export function analyseTimeframe(candles) {
  if (!Array.isArray(candles) || candles.length < 60) {
    throw new Error("Not enough candles for analysis.");
  }

  const closes = candles.map(c => Number(c.close));
  const close = closes.at(-1);

  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const macdData = macd(closes);
  const atr14 = atr(candles, 14);

  // Use the dedicated Volume Profile calculation.
  const profile = calculateVolumeProfile(candles, 24, 0.70);
  const vwap = rollingVwap(candles, 24);
  const cvd = cumulativeVolumeDeltaProxy(candles, 5);

  const structure = marketStructure(candles);
  const smartMoney = analyzeSmartMoney(candles);
  const squeeze = squeezeMomentum(candles);

  const bullish = [
    close > ema20,
    ema20 > ema50,
    rsi14 > 50,
    macdData.line > macdData.signal
  ];

  const bearish = [
    close < ema20,
    ema20 < ema50,
    rsi14 < 50,
    macdData.line < macdData.signal
  ];

  return {
    close,
    ema20,
    ema50,
    rsi14,
    macd: macdData.line,
    macdSignal: macdData.signal,
    macdHistogram: macdData.histogram,
    atr14,

    // Volume Profile
    poc: profile.poc,
    valueAreaHigh: profile.valueAreaHigh,
    valueAreaLow: profile.valueAreaLow,
    profileVolume: profile.totalVolume,
    vwap,
    cvd,

    squeeze,
    structure,
    smartMoney,

    bullishVotes: bullish.filter(Boolean).length,
    bearishVotes: bearish.filter(Boolean).length,
    bullishConditions: bullish,
    bearishConditions: bearish
  };
}
