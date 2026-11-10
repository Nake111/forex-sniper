// Six deterministic quantitative forecasting agents.
// They estimate distributions from closed candles only; they do not know future prices.
// Each model forecasts the next three candles and abstains when evidence is weak.

const HORIZON = 3;
const MIN_MOVE_ATR = 0.12;

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function variance(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return mean(values.map(value => (value - m) ** 2));
}
function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}
function logistic(value) {
  return 1 / (1 + Math.exp(-clamp(value, -8, 8)));
}
function prepare(candles) {
  if (!Array.isArray(candles) || candles.length < 70) return null;
  const closes = candles.map(candle => Number(candle.close));
  if (!closes.every(value => Number.isFinite(value) && value > 0)) return null;
  const returns = closes.slice(1).map((value, index) => Math.log(value / closes[index]));
  const ranges = candles.slice(-30).map(candle => Number(candle.high) - Number(candle.low))
    .filter(value => Number.isFinite(value) && value > 0);
  const atr = mean(ranges);
  const price = closes.at(-1);
  if (!(atr > 0) || !(price > 0)) return null;
  return { closes, returns, atr, price, atrPct: atr / price };
}
function makeForecast(name, model, expectedLogReturn, sigma, detail = {}) {
  const valid = Number.isFinite(expectedLogReturn) && Number.isFinite(sigma) && sigma > 0;
  const expectedMoveAtr = valid ? expectedLogReturn * HORIZON / (detail.atrPct || 1) : 0;
  const z = valid ? expectedLogReturn * Math.sqrt(HORIZON) / sigma : 0;
  const probabilityUp = valid ? logistic(z * 1.35) : 0.5;
  const direction = valid && expectedMoveAtr >= MIN_MOVE_ATR && probabilityUp >= 0.58 ? "BUY"
    : valid && expectedMoveAtr <= -MIN_MOVE_ATR && probabilityUp <= 0.42 ? "SELL" : "HOLD";
  return {
    name, model, direction,
    horizonCandles: HORIZON,
    probabilityUpPct: Math.round(probabilityUp * 100),
    expectedMoveAtr: Number(expectedMoveAtr.toFixed(3)),
    forecastReturnPct: valid ? Number(((Math.exp(expectedLogReturn * HORIZON) - 1) * 100).toFixed(4)) : null,
    confidencePct: valid ? Math.round(Math.max(probabilityUp, 1 - probabilityUp) * 100) : 50,
    evidence: detail.evidence ?? (valid ? "Model estimate from closed-candle history" : "Insufficient or unstable data")
  };
}

// 1. Exponentially weighted least-squares trend projection with a residual t-statistic.
function weightedRegression(data) {
  const sample = data.returns.slice(-60);
  if (sample.length < 40) return makeForecast("Quantitative agent 1 — weighted regression", "EWLS trend projection", NaN, NaN, { atrPct: data.atrPct });
  const y = sample.map((_, index) => Math.log(data.closes[data.closes.length - sample.length + index]));
  const weights = y.map((_, index) => Math.exp((index - (y.length - 1)) / 18));
  const x = y.map((_, index) => index);
  const sw = weights.reduce((a, b) => a + b, 0);
  const xm = x.reduce((sum, value, i) => sum + value * weights[i], 0) / sw;
  const ym = y.reduce((sum, value, i) => sum + value * weights[i], 0) / sw;
  const slope = y.reduce((sum, value, i) => sum + weights[i] * (x[i] - xm) * (value - ym), 0) /
    y.reduce((sum, value, i) => sum + weights[i] * (value - xm) ** 2, 0);
  const intercept = ym - slope * xm;
  const residuals = y.map((value, i) => value - (intercept + slope * x[i]));
  const se = Math.sqrt(mean(residuals.map(value => value ** 2)));
  const t = se > 0 ? slope / (se / Math.sqrt(y.length)) : 0;
  return makeForecast("Quantitative agent 1 — weighted regression", "Exponentially weighted least-squares trend", slope, Math.max(se, Math.sqrt(variance(data.returns.slice(-30))), 1e-8), {
    atrPct: data.atrPct, evidence: `60-bar weighted slope; residual t-statistic ${t.toFixed(2)}`
  });
}

// 2. AR(1) return model with bounded persistence and three-step conditional expectation.
function autoregression(data) {
  const r = data.returns.slice(-100);
  const x = r.slice(0, -1), y = r.slice(1);
  const xm = mean(x), ym = mean(y);
  const phi = x.reduce((sum, value, i) => sum + (value - xm) * (y[i] - ym), 0) /
    (x.reduce((sum, value) => sum + (value - xm) ** 2, 0) || 1);
  const alpha = ym - phi * xm;
  const bounded = clamp(phi, -0.98, 0.98);
  let forecast = 0, current = r.at(-1);
  for (let step = 0; step < HORIZON; step++) {
    current = alpha + bounded * current;
    forecast += current;
  }
  const residuals = y.map((value, i) => value - alpha - phi * x[i]);
  return makeForecast("Quantitative agent 2 — autoregression", "AR(1) conditional return model", forecast / HORIZON,
    Math.sqrt(Math.max(variance(residuals), 1e-16)), {
      atrPct: data.atrPct, evidence: `AR(1) persistence ${phi.toFixed(3)}; three-step cumulative expectation ${(forecast * 100).toFixed(4)}%`
    });
}

// 3. Two-state local-linear-trend Kalman filter on log price (level + velocity).
function kalmanTrend(data) {
  const observations = data.closes.slice(-100).map(Math.log);
  if (observations.length < 60) return makeForecast("Quantitative agent 3 — Kalman filter", "Local-linear-trend Kalman filter", NaN, NaN, { atrPct: data.atrPct });
  const diffs = observations.slice(1).map((value, index) => value - observations[index]);
  const measurementNoise = Math.max(variance(diffs) * 0.35, 1e-10);
  const processNoise = Math.max(variance(diffs) * 0.015, 1e-12);
  let level = observations[0], velocity = 0;
  let p00 = measurementNoise, p01 = 0, p11 = measurementNoise;
  for (const observation of observations.slice(1)) {
    const predictedLevel = level + velocity;
    const predictedP00 = p00 + 2 * p01 + p11 + processNoise;
    const predictedP01 = p01 + p11;
    const predictedP11 = p11 + processNoise * 0.1;
    const innovation = observation - predictedLevel;
    const innovationVariance = predictedP00 + measurementNoise;
    const k0 = predictedP00 / innovationVariance;
    const k1 = predictedP01 / innovationVariance;
    level = predictedLevel + k0 * innovation;
    velocity += k1 * innovation;
    p00 = (1 - k0) * predictedP00;
    p01 = (1 - k0) * predictedP01;
    p11 = predictedP11 - k1 * predictedP01;
  }
  return makeForecast("Quantitative agent 3 — Kalman filter", "Two-state local-linear-trend Kalman filter", velocity,
    Math.sqrt(Math.max(p11, variance(diffs.slice(-30)), 1e-12)), {
      atrPct: data.atrPct, evidence: `Filtered log-price velocity ${(velocity * 100).toFixed(5)}% per candle; state covariance included`
    });
}

// 4. EWMA volatility forecast with volatility-scaled recent drift (RiskMetrics-style).
function ewmaMomentum(data) {
  const r = data.returns.slice(-80);
  let sigma2 = variance(r.slice(0, 20));
  for (const value of r) sigma2 = 0.94 * sigma2 + 0.06 * value ** 2;
  const drift = mean(r.slice(-12));
  const scaled = drift / Math.sqrt(Math.max(sigma2, 1e-16));
  return makeForecast("Quantitative agent 4 — EWMA volatility", "Volatility-adjusted drift / EWMA variance", drift,
    Math.sqrt(Math.max(sigma2, 1e-16)), {
      atrPct: data.atrPct, evidence: `EWMA lambda 0.94; drift-to-volatility ratio ${scaled.toFixed(3)}`
    });
}

// 5. Dominant autocorrelation cycle with sinusoidal least-squares phase projection.
function cycleModel(data) {
  const r = data.returns.slice(-100);
  if (r.length < 70) return makeForecast("Quantitative agent 5 — cycle model", "Autocorrelation + harmonic projection", NaN, NaN, { atrPct: data.atrPct });
  const centered = r.map(value => value - mean(r));
  let best = { lag: 0, correlation: 0 };
  for (let lag = 3; lag <= 20; lag++) {
    const a = centered.slice(lag), b = centered.slice(0, -lag);
    const denom = Math.sqrt(a.reduce((s, v) => s + v * v, 0) * b.reduce((s, v) => s + v * v, 0));
    const correlation = denom ? a.reduce((s, v, i) => s + v * b[i], 0) / denom : 0;
    if (Math.abs(correlation) > Math.abs(best.correlation)) best = { lag, correlation };
  }
  const period = best.lag;
  const omega = 2 * Math.PI / period;
  const cosine = centered.reduce((s, value, i) => s + value * Math.cos(omega * i), 0);
  const sine = centered.reduce((s, value, i) => s + value * Math.sin(omega * i), 0);
  const norm = 2 / centered.length;
  let projected = 0;
  for (let step = 1; step <= HORIZON; step++) {
    const index = centered.length - 1 + step;
    projected += norm * (cosine * Math.cos(omega * index) + sine * Math.sin(omega * index));
  }
  const forecast = projected / HORIZON;
  return makeForecast("Quantitative agent 5 — cycle model", "Dominant autocorrelation + harmonic projection", forecast,
    Math.sqrt(Math.max(variance(r), 1e-16)), {
      atrPct: data.atrPct, evidence: `Dominant lag ${period}; autocorrelation ${best.correlation.toFixed(3)}; sinusoidal phase projection`
    });
}

// 6. Similar historical eight-return patterns; weighted outcomes over the next three bars.
function analogModel(data) {
  const r = data.returns;
  const patternLength = 8;
  const latest = r.slice(-patternLength);
  const scale = Math.sqrt(variance(latest)) || 1e-8;
  const matches = [];
  for (let start = 0; start <= r.length - patternLength - HORIZON - 1; start++) {
    const candidate = r.slice(start, start + patternLength);
    const distance = Math.sqrt(mean(candidate.map((value, i) => ((value - latest[i]) / scale) ** 2)));
    if (Number.isFinite(distance)) {
      const outcome = r.slice(start + patternLength, start + patternLength + HORIZON).reduce((sum, value) => sum + value, 0);
      matches.push({ distance, outcome });
    }
  }
  matches.sort((a, b) => a.distance - b.distance);
  const nearest = matches.slice(0, 20);
  if (nearest.length < 8) return makeForecast("Quantitative agent 6 — analog search", "Nearest-neighbour historical pattern outcomes", NaN, NaN, { atrPct: data.atrPct });
  const weights = nearest.map(item => Math.exp(-item.distance));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const forecast = nearest.reduce((sum, item, i) => sum + item.outcome * weights[i], 0) / totalWeight;
  const probabilityUp = nearest.reduce((sum, item, i) => sum + (item.outcome > 0 ? weights[i] : 0), 0) / totalWeight;
  const sigma = Math.sqrt(Math.max(variance(nearest.map(item => item.outcome)), 1e-16));
  const result = makeForecast("Quantitative agent 6 — analog search", "Nearest-neighbour historical pattern outcomes", forecast / HORIZON, sigma / Math.sqrt(HORIZON), {
    atrPct: data.atrPct, evidence: `20 closest historical 8-return patterns; weighted positive outcomes ${(probabilityUp * 100).toFixed(1)}%; no future bars used`
  });
  // Blend model's continuous probability with empirical analog hit frequency.
  result.probabilityUpPct = Math.round(0.5 * result.probabilityUpPct + 0.5 * probabilityUp * 100);
  result.direction = result.expectedMoveAtr >= MIN_MOVE_ATR && result.probabilityUpPct >= 58 ? "BUY"
    : result.expectedMoveAtr <= -MIN_MOVE_ATR && result.probabilityUpPct <= 42 ? "SELL" : "HOLD";
  result.confidencePct = Math.max(result.probabilityUpPct, 100 - result.probabilityUpPct);
  return result;
}

export function runForecastAgents(candles) {
  const data = prepare(candles);
  if (!data) return [
    "weighted regression", "autoregression", "Kalman filter", "EWMA volatility", "cycle model", "analog search"
  ].map((model, index) => ({
    name: `Quantitative agent ${index + 1} — ${model}`, model, direction: "HOLD",
    horizonCandles: HORIZON, probabilityUpPct: 50, expectedMoveAtr: 0,
    forecastReturnPct: null, confidencePct: 50, evidence: "At least 70 valid closed candles required"
  }));
  return [
    weightedRegression(data), autoregression(data), kalmanTrend(data),
    ewmaMomentum(data), cycleModel(data), analogModel(data)
  ];
}
