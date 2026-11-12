/**
 * Empirical market-data learner.
 *
 * Learns conditional forward-return behaviour from provider-refreshed OHLCV
 * candles only. It never reads the paper journal or paper trade outcomes.
 * The first 70% of candles is the training window; the final 30% is reserved.
 * The latest candle is used only to identify the current context.
 */
const finite = Number.isFinite;
const HORIZON = 3;
const TRAINING_RATIO = 0.7;

function ema(values, period) {
  if (values.length < period) return null;
  let value = values.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
  const alpha = 2 / (period + 1);
  for (let i = period; i < values.length; i++) value += alpha * (values[i] - value);
  return value;
}

function volatilityAt(candles, index, period = 20) {
  if (index < period) return null;
  const returns = [];
  for (let i = index - period + 1; i <= index; i++) {
    const previous = Number(candles[i - 1]?.close);
    const current = Number(candles[i]?.close);
    if (!(previous > 0 && current > 0)) return null;
    returns.push(Math.log(current / previous));
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  return Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length);
}

function directionAt(candles, index) {
  const closes = candles.slice(0, index + 1).map(candle => Number(candle.close));
  const fast = ema(closes, 20);
  const slow = ema(closes, 50);
  if (!finite(fast) || !finite(slow) || fast === slow) return "RANGE";
  return fast > slow ? "BUY" : "SELL";
}

function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function volatilityBucket(value, low, high) {
  if (!finite(value) || !finite(low) || !finite(high)) return "UNKNOWN";
  return value <= low ? "LOW" : value <= high ? "NORMAL" : "HIGH";
}

function timestampOf(candle) {
  const raw = candle?.timestamp ?? candle?.time ?? candle?.date;
  const parsed = typeof raw === "number" ? raw : Date.parse(raw);
  return finite(parsed) ? (parsed < 1e12 ? parsed * 1000 : parsed) : null;
}

export function learnFromMarketData(candles, {
  market = "UNKNOWN",
  trainingRatio = TRAINING_RATIO,
  horizon = HORIZON,
  minSamples = 30
} = {}) {
  if (!Array.isArray(candles) || ![...candles].every(c =>
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
  const firstIndex = 50;
  const lastTrainingIndex = trainEnd - horizon - 1;
  if (lastTrainingIndex < firstIndex + minSamples) {
    return {
      status: "INSUFFICIENT_DATA", market, trainingSource: "ONLINE_MARKET_CANDLES_ONLY",
      candleCount: ordered.length, trainingBars: Math.max(0, trainEnd),
      reservedBars: ordered.length - trainEnd,
      reason: `Need at least ${minSamples} training observations after warm-up`
    };
  }

  const trainingVolatility = [];
  for (let i = firstIndex; i <= lastTrainingIndex; i++) {
    const value = volatilityAt(ordered, i);
    if (finite(value)) trainingVolatility.push(value);
  }
  const lowVol = quantile(trainingVolatility, 1 / 3);
  const highVol = quantile(trainingVolatility, 2 / 3);
  const buckets = new Map();
  let observations = 0;

  for (let i = firstIndex; i <= lastTrainingIndex; i++) {
    const volatility = volatilityAt(ordered, i);
    const direction = directionAt(ordered, i);
    const bucket = volatilityBucket(volatility, lowVol, highVol);
    const start = Number(ordered[i].close);
    const end = Number(ordered[i + horizon].close);
    if (!(start > 0 && end > 0) || direction === "RANGE" || bucket === "UNKNOWN") continue;
    const forwardReturn = Math.log(end / start);
    const key = `${direction}:${bucket}`;
    const stat = buckets.get(key) ?? { direction, volatility: bucket, samples: 0, wins: 0, sumReturn: 0, sumSquaredReturn: 0 };
    stat.samples++;
    stat.wins += direction === "BUY" ? Number(forwardReturn > 0) : Number(forwardReturn < 0);
    const directionalReturn = direction === "BUY" ? forwardReturn : -forwardReturn;
    stat.sumReturn += directionalReturn;
    stat.sumSquaredReturn += directionalReturn ** 2;
    buckets.set(key, stat);
    observations++;
  }

  const profiles = [...buckets.values()].map(stat => ({
    direction: stat.direction,
    volatility: stat.volatility,
    samples: stat.samples,
    directionalHitRatePct: Number((stat.wins / stat.samples * 100).toFixed(1)),
    averageDirectionalReturnBps: Number((stat.sumReturn / stat.samples * 10_000).toFixed(3)),
    returnStdDevBps: Number((Math.sqrt(Math.max(0, stat.sumSquaredReturn / stat.samples - (stat.sumReturn / stat.samples) ** 2)) * 10_000).toFixed(3))
  })).sort((a, b) => a.direction.localeCompare(b.direction) || a.volatility.localeCompare(b.volatility));

  const currentIndex = ordered.length - 1;
  const currentDirection = directionAt(ordered, currentIndex);
  const currentVolatility = volatilityAt(ordered, currentIndex);
  const currentBucket = volatilityBucket(currentVolatility, lowVol, highVol);
  const currentProfile = profiles.find(p => p.direction === currentDirection && p.volatility === currentBucket) ?? null;
  return {
    status: observations >= minSamples ? "LEARNED_FROM_MARKET_DATA" : "LOW_SAMPLE_MARKET_DATA",
    market,
    trainingSource: "ONLINE_MARKET_CANDLES_ONLY",
    dataBasis: "Historical provider-refreshed OHLCV candles; no paper journal, paper signals or simulated trade outcomes used",
    candleCount: ordered.length,
    trainingBars: trainEnd,
    reservedBars: ordered.length - trainEnd,
    trainingRatio,
    holdoutPolicy: "Final 30% reserved; never used to fit conditional return profiles",
    horizonCandles: horizon,
    observations,
    currentContext: {
      direction: currentDirection,
      volatility: currentBucket,
      volatilityStdDev: finite(currentVolatility) ? Number((currentVolatility * 10_000).toFixed(3)) : null,
      matchedProfile: currentProfile
    },
    profiles,
    trainingFrom: timestampOf(ordered[0]) === null ? null : new Date(timestampOf(ordered[0])).toISOString(),
    trainingThrough: timestampOf(ordered[Math.max(0, trainEnd - 1)]) === null ? null : new Date(timestampOf(ordered[trainEnd - 1])).toISOString(),
    latestCandleAt: timestampOf(ordered[currentIndex]) === null ? null : new Date(timestampOf(ordered[currentIndex])).toISOString(),
    paperOutcomesUsed: false
  };
}
