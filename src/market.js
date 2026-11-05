
import { analyzeMarketStructure } from "./market-structure.js";

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

  if (avgLoss === 0) return 100;
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

export function volumeProfile(candles, bins = 24) {
  const usable = candles.filter(c =>
    Number.isFinite(c.volume) && c.volume > 0
  );

  if (!usable.length) {
    return { poc: null, levels: [] };
  }

  const low = Math.min(...usable.map(c => c.low));
  const high = Math.max(...usable.map(c => c.high));

  if (high <= low) {
    return { poc: low, levels: [] };
  }

  const step = (high - low) / bins;
  const levels = Array(bins).fill(0);

  for (const candle of usable) {
    const typical =
      (candle.high + candle.low + candle.close) / 3;

    const index = Math.max(
      0,
      Math.min(bins - 1, Math.floor((typical - low) / step))
    );

    levels[index] += candle.volume;
  }

  const maxIndex = levels.indexOf(Math.max(...levels));

  return {
    poc: low + (maxIndex + 0.5) * step,
    levels
  };
}

export function marketStructure(candles) {
  const structure = analyzeMarketStructure(candles, 3);

  return {
    ...structure,
    sweep: structure.sweepConfirmed
      ? structure.liquiditySweep
      : "NONE"
  };
}

export function analyseTimeframe(candles) {
  if (!Array.isArray(candles) || candles.length < 60) {
    throw new Error("Not enough candles for analysis.");
  }

  const closes = candles.map(c => c.close);
  const close = closes.at(-1);

  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const macdData = macd(closes);
  const atr14 = atr(candles, 14);
  const profile = volumeProfile(candles);
  const structure = marketStructure(candles);

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
    poc: profile.poc,
    structure,
    bullishVotes: bullish.filter(Boolean).length,
    bearishVotes: bearish.filter(Boolean).length,
    bullishConditions: bullish,
    bearishConditions: bearish
  };
}
