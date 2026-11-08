// Research candidate: Donchian breakout + multi-timeframe trend/volatility filters.
// This is a testable hypothesis, not a claim of guaranteed profitability.

function ema(values, period) {
  if (values.length < period) return null;
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const alpha = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    value += alpha * (values[i] - value);
  }
  return value;
}

function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const tr = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  let value = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < tr.length; i++) value = (value * (period - 1) + tr[i]) / period;
  return value;
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    gain += Math.max(change, 0);
    loss += Math.max(-change, 0);
  }
  let avgGain = gain / period, avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function adx(candles, period = 14) {
  if (candles.length < period * 2 + 1) return null;
  const tr = [], plus = [], minus = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const up = c.high - p.high, down = p.low - c.low;
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    plus.push(up > down && up > 0 ? up : 0);
    minus.push(down > up && down > 0 ? down : 0);
  }
  let smTR = tr.slice(0, period).reduce((a,b)=>a+b,0);
  let smPlus = plus.slice(0, period).reduce((a,b)=>a+b,0);
  let smMinus = minus.slice(0, period).reduce((a,b)=>a+b,0);
  const dx = [];
  for (let i = period; i < tr.length; i++) {
    if (i > period) {
      smTR = smTR - smTR / period + tr[i];
      smPlus = smPlus - smPlus / period + plus[i];
      smMinus = smMinus - smMinus / period + minus[i];
    }
    const pdi = smTR ? 100 * smPlus / smTR : 0;
    const mdi = smTR ? 100 * smMinus / smTR : 0;
    dx.push(pdi + mdi ? 100 * Math.abs(pdi - mdi) / (pdi + mdi) : 0);
  }
  if (dx.length < period) return null;
  let value = dx.slice(0, period).reduce((a,b)=>a+b,0) / period;
  for (let i = period; i < dx.length; i++) value = (value * (period - 1) + dx[i]) / period;
  return value;
}

export function analyseDonchian(candles, lookback = 20) {
  if (!Array.isArray(candles) || candles.length < 220) {
    throw new Error("Donchian strategy requires at least 220 closed candles");
  }
  const closes = candles.map(c => Number(c.close));
  const highs = candles.map(c => Number(c.high));
  const lows = candles.map(c => Number(c.low));
  const volumes = candles.map(c => Number(c.volume ?? 0));
  const last = candles.length - 1;
  const priorHigh = Math.max(...highs.slice(last - lookback, last));
  const priorLow = Math.min(...lows.slice(last - lookback, last));
  const previousHigh = Math.max(...highs.slice(last - lookback - 1, last - 1));
  const previousLow = Math.min(...lows.slice(last - lookback - 1, last - 1));
  const averageVolume = volumes.slice(last - lookback, last).reduce((a,b)=>a+b,0) / lookback;
  const volumeRatio = averageVolume > 0 ? volumes[last] / averageVolume : null;
  return {
    close: closes[last],
    previousClose: closes[last - 1],
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    rsi14: rsi(closes, 14),
    atr14: atr(candles, 14),
    adx14: adx(candles, 14),
    channelHigh20: priorHigh,
    channelLow20: priorLow,
    previousChannelHigh20: previousHigh,
    previousChannelLow20: previousLow,
    volumeRatio
  };
}

export function evaluateDonchianSignal({ M5, M15, H1 }) {
  const values = [M5, M15, H1];
  if (values.some(v => !v || !Number.isFinite(v.atr14) || v.atr14 <= 0)) return "HOLD";

  const h1Bull = H1.close > H1.ema200 && H1.ema50 > H1.ema200;
  const h1Bear = H1.close < H1.ema200 && H1.ema50 < H1.ema200;
  const m15BreakUp = M15.close > M15.channelHigh20 && M15.previousClose <= M15.previousChannelHigh20;
  const m15BreakDown = M15.close < M15.channelLow20 && M15.previousClose >= M15.previousChannelLow20;
  const quality = M15.adx14 >= 18 && M15.volumeRatio >= 1.15;

  if (h1Bull && m15BreakUp && quality &&
      M5.close > M5.ema20 && M5.rsi14 >= 50 && M5.rsi14 <= 72) return "BUY";

  if (h1Bear && m15BreakDown && quality &&
      M5.close < M5.ema20 && M5.rsi14 <= 50 && M5.rsi14 >= 28) return "SELL";

  return "HOLD";
}

export function donchianTradePlan(signal, m5, costBps = 10) {
  if (!["BUY", "SELL"].includes(signal) || !Number.isFinite(m5?.close) ||
      !Number.isFinite(m5?.atr14) || m5.atr14 <= 0) return null;
  const risk = 2 * m5.atr14;
  const reward = 3 * m5.atr14;
  return signal === "BUY"
    ? { entry: m5.close, stopLoss: m5.close - risk, takeProfit: m5.close + reward, riskReward: "1:1.5", costBps }
    : { entry: m5.close, stopLoss: m5.close + risk, takeProfit: m5.close - reward, riskReward: "1:1.5", costBps };
}
