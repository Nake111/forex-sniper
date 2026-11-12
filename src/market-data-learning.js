/**
 * Empirical market-data learner. It uses provider-refreshed OHLCV candles only.
 * The first 70% is the training window; the final 30% is reserved.
 * Paper journals and simulated trade outcomes are never read.
 */
const finite = Number.isFinite;
const HORIZON = 3;
const TRAINING_RATIO = 0.7;

function emaSeries(values, period) {
  const output = Array(values.length).fill(null);
  if (values.length < period) return output;
  let value = values.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
  output[period - 1] = value;
  const alpha = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    value += alpha * (values[i] - value);
    output[i] = value;
  }
  return output;
}

function volatilityAt(candles, index, period = 20) {
  if (index < period) return null;
  const returns = [];
  for (let i = index - period + 1; i <= index; i++) {
    const previous = Number(candles[i - 1]?.close), current = Number(candles[i]?.close);
    if (!(previous > 0 && current > 0)) return null;
    returns.push(Math.log(current / previous));
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  return Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length);
}

function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function volatilityBucket(value, low, high) {
  if (![value, low, high].every(finite)) return "UNKNOWN";
  return value <= low ? "LOW" : value <= high ? "NORMAL" : "HIGH";
}

function timestampOf(candle) {
  const raw = candle?.timestamp ?? candle?.time ?? candle?.date;
  const parsed = typeof raw === "number" ? raw : Date.parse(raw);
  return finite(parsed) ? (parsed < 1e12 ? parsed * 1000 : parsed) : null;
}

export function learnFromMarketData(candles, {
  market = "UNKNOWN", trainingRatio = TRAINING_RATIO, horizon = HORIZON, minSamples = 30
} = {}) {
  if (!Array.isArray(candles) || !candles.every(c =>
    [c.open, c.high, c.low, c.close].every(value => finite(Number(value))) &&
    Number(c.close) > 0 && Number(c.high) >= Number(c.low)
  )) {
    return { status: "INSUFFICIENT_DATA", market, reason: "Invalid OHLC candle history", trainingSource: "ONLINE_MARKET_CANDLES_ONLY" };
  }
  if (!(trainingRatio > 0.5 && trainingRatio < 1) || !Number.isInteger(horizon) || horizon < 1) {
    throw new Error("Invalid market-data learning configuration");
  }
  const ordered = [...candles].sort((a, b) => (timestampOf(a) ?? 0) - (timestampOf(b) ?? 0));
  const trainEnd = Math.floor(ordered.length * trainingRatio);
  const firstIndex = 50, lastTrainingIndex = trainEnd - horizon - 1;
  if (lastTrainingIndex < firstIndex + minSamples) {
    return {
      status: "INSUFFICIENT_DATA", market, trainingSource: "ONLINE_MARKET_CANDLES_ONLY",
      candleCount: ordered.length, trainingBars: trainEnd, reservedBars: ordered.length - trainEnd,
      reason: `Need at least ${minSamples} training observations after warm-up`
    };
  }

  const closes = ordered.map(candle => Number(candle.close));
  const ema20 = emaSeries(closes, 20), ema50 = emaSeries(closes, 50);
  const directionAt = index => !finite(ema20[index]) || !finite(ema50[index]) || ema20[index] === ema50[index]
    ? "RANGE" : ema20[index] > ema50[index] ? "BUY" : "SELL";

  const trainingVolatility = [];
  for (let i = firstIndex; i <= lastTrainingIndex; i++) {
    const value = volatilityAt(ordered, i);
    if (finite(value)) trainingVolatility.push(value);
  }
  const lowVol = quantile(trainingVolatility, 1 / 3), highVol = quantile(trainingVolatility, 2 / 3);
  const buckets = new Map();
  let observations = 0;
  for (let i = firstIndex; i <= lastTrainingIndex; i++) {
    const volatility = volatilityAt(ordered, i);
    const direction = directionAt(i), bucket = volatilityBucket(volatility, lowVol, highVol);
    const start = Number(ordered[i].close), end = Number(ordered[i + horizon].close);
    if (!(start > 0 && end > 0) || direction === "RANGE" || bucket === "UNKNOWN") continue;
    const forwardReturn = Math.log(end / start);
    const key = `${direction}:${bucket}`;
    const stat = buckets.get(key) ?? { direction, volatility: bucket, samples: 0, wins: 0, sumReturn: 0, sumSquaredReturn: 0 };
    stat.samples++;
    stat.wins += Number(direction === "BUY" ? forwardReturn > 0 : forwardReturn < 0);
    const directionalReturn = direction === "BUY" ? forwardReturn : -forwardReturn;
    stat.sumReturn += directionalReturn;
    stat.sumSquaredReturn += directionalReturn ** 2;
    buckets.set(key, stat);
    observations++;
  }
  const profiles = [...buckets.values()].map(stat => ({
    direction: stat.direction, volatility: stat.volatility, samples: stat.samples,
    directionalHitRatePct: Number((stat.wins / stat.samples * 100).toFixed(1)),
    averageDirectionalReturnBps: Number((stat.sumReturn / stat.samples * 10_000).toFixed(3)),
    returnStdDevBps: Number((Math.sqrt(Math.max(0, stat.sumSquaredReturn / stat.samples - (stat.sumReturn / stat.samples) ** 2)) * 10_000).toFixed(3))
  })).sort((a, b) => a.direction.localeCompare(b.direction) || a.volatility.localeCompare(b.volatility));

  const currentIndex = ordered.length - 1;
  const currentDirection = directionAt(currentIndex);
  const currentVolatility = volatilityAt(ordered, currentIndex);
  const currentBucket = volatilityBucket(currentVolatility, lowVol, highVol);
  const currentProfile = profiles.find(p => p.direction === currentDirection && p.volatility === currentBucket) ?? null;
  const firstAt = timestampOf(ordered[0]), trainAt = timestampOf(ordered[trainEnd - 1]), latestAt = timestampOf(ordered[currentIndex]);
  return {
    status: observations >= minSamples ? "LEARNED_FROM_MARKET_DATA" : "LOW_SAMPLE_MARKET_DATA",
    market, trainingSource: "ONLINE_MARKET_CANDLES_ONLY",
    dataBasis: "Provider-refreshed OHLCV history; no paper journal, paper signals or simulated outcomes used",
    candleCount: ordered.length, trainingBars: trainEnd, reservedBars: ordered.length - trainEnd,
    trainingRatio, holdoutPolicy: "Final 30% reserved; never used to fit conditional return profiles",
    horizonCandles: horizon, observations,
    currentContext: {
      direction: currentDirection, volatility: currentBucket,
      volatilityStdDev: finite(currentVolatility) ? Number((currentVolatility * 10_000).toFixed(3)) : null,
      matchedProfile: currentProfile
    },
    profiles,
    trainingFrom: firstAt === null ? null : new Date(firstAt).toISOString(),
    trainingThrough: trainAt === null ? null : new Date(trainAt).toISOString(),
    latestCandleAt: latestAt === null ? null : new Date(latestAt).toISOString(),
    paperOutcomesUsed: false
  };
}
