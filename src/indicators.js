export function ema(values, period) {
  const result = Array(values.length).fill(null);
  if (values.length < period) return result;

  const seed = values.slice(0, period)
    .reduce((sum, value) => sum + value, 0) / period;

  const multiplier = 2 / (period + 1);
  result[period - 1] = seed;

  for (let i = period; i < values.length; i++) {
    result[i] =
      (values[i] - result[i - 1]) * multiplier + result[i - 1];
  }

  return result;
}

export function rsi(closes, period = 14) {
  const result = Array(closes.length).fill(null);
  if (closes.length <= period) return result;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  result[period] = avgLoss === 0
    ? 100
    : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];

    avgGain = (avgGain * (period - 1) +
      Math.max(change, 0)) / period;

    avgLoss = (avgLoss * (period - 1) +
      Math.max(-change, 0)) / period;

    result[i] = avgLoss === 0
      ? 100
      : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return result;
}

export function macd(closes) {
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);

  const line = closes.map((_, i) =>
    fast[i] === null || slow[i] === null
      ? null
      : fast[i] - slow[i]
  );

  const first = line.findIndex(value => value !== null);
  const signalValues = ema(line.slice(first), 9);
  const signal = Array(closes.length).fill(null);

  signalValues.forEach((value, i) => {
    signal[first + i] = value;
  });

  const histogram = line.map((value, i) =>
    value === null || signal[i] === null
      ? null
      : value - signal[i]
  );

  return { line, signal, histogram };
}

export function atr(candles, period = 14) {
  const ranges = candles.map((candle, i) => {
    const high = Number(candle.high);
    const low = Number(candle.low);
    const previousClose = i === 0
      ? Number(candle.close)
      : Number(candles[i - 1].close);

    return Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose)
    );
  });

  const result = Array(candles.length).fill(null);
  if (candles.length < period) return result;

  let current = ranges.slice(0, period)
    .reduce((sum, value) => sum + value, 0) / period;

  result[period - 1] = current;

  for (let i = period; i < candles.length; i++) {
    current = (current * (period - 1) + ranges[i]) / period;
    result[i] = current;
  }

  return result;
}

export function calculateIndicators(candles) {
  const closes = candles.map(c => Number(c.close));

  if (closes.some(value => !Number.isFinite(value))) {
    throw new Error("Invalid candle close price");
  }

  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const macdResult = macd(closes);
  const atr14 = atr(candles, 14);

  return candles.map((candle, i) => ({
    ...candle,
    ema20: ema20[i],
    ema50: ema50[i],
    rsi14: rsi14[i],
    macd: macdResult.line[i],
    macdSignal: macdResult.signal[i],
    macdHistogram: macdResult.histogram[i],
    atr14: atr14[i]
  }));
}
