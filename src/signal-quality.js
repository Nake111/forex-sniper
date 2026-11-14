import { createHash } from "node:crypto";

const SIDES = new Set(["BUY", "SELL"]);
const finite = Number.isFinite;
const round = (n, d = 4) => finite(n) ? Number(n.toFixed(d)) : null;

/** Classify conditions from closed-bar data only. Abnormal overrides all other regimes. */
export function classifyMarketRegime({ close, ema20, ema50, ema200, adx14, atr14, atrBaseline, candleRange, rangeBaseline }) {
  if (![close, ema50, ema200].every(finite)) return "UNKNOWN";
  if ((finite(atr14) && finite(atrBaseline) && atrBaseline > 0 && atr14 / atrBaseline >= 3) ||
      (finite(candleRange) && finite(rangeBaseline) && rangeBaseline > 0 && candleRange / rangeBaseline >= 4)) return "ABNORMAL";
  if (finite(atr14) && finite(atrBaseline) && atrBaseline > 0 && atr14 / atrBaseline >= 1.8) return "HIGH_VOLATILITY";
  if (finite(adx14) && adx14 < 16) return "RANGE";
  if (close > ema50 && ema50 > ema200 && (!finite(ema20) || ema20 >= ema50)) return "BULL_TREND";
  if (close < ema50 && ema50 < ema200 && (!finite(ema20) || ema20 <= ema50)) return "BEAR_TREND";
  return "RANGE";
}

/** Precision and false-signal accounting, split by predicted BUY and SELL. */
export function measureDirectionalAccuracy(rows) {
  const result = {};
  for (const side of ["BUY", "SELL"]) {
    const sample = rows.filter(row => row.predictedSide === side && row.actualDirection);
    const correct = sample.filter(row => row.actualDirection === side).length;
    const falseSignals = sample.length - correct;
    result[side] = {
      predictions: sample.length, correct, falseSignals,
      accuracyPct: sample.length ? round(correct / sample.length * 100, 2) : null,
      falseSignalRatePct: sample.length ? round(falseSignals / sample.length * 100, 2) : null
    };
  }
  return result;
}

/** Chronological 70/30 partition with a digest to detect accidental holdout mutation. */
export function createChronologicalHoldout(records, ratio = 0.3) {
  if (!Array.isArray(records) || !finite(ratio) || ratio <= 0 || ratio >= 1) throw new Error("Invalid records or holdout ratio");
  const split = Math.floor(records.length * (1 - ratio));
  const training = records.slice(0, split);
  const holdout = records.slice(split);
  const holdoutDigest = createHash("sha256").update(JSON.stringify(holdout)).digest("hex");
  return Object.freeze({
    training, holdout, splitIndex: split, holdoutRatio: ratio,
    holdoutDigest, holdoutLocked: true,
    assertUnchanged(currentHoldout) {
      const digest = createHash("sha256").update(JSON.stringify(currentHoldout)).digest("hex");
      if (digest !== holdoutDigest) throw new Error("HOLDOUT_INTEGRITY_VIOLATION: untouched holdout changed");
      return true;
    }
  });
}

export function buildAgentForecasts({ agents = [], market, candleAt, close, atr14, regime = "UNKNOWN" }) {
  return agents.filter(agent => agent && typeof agent.name === "string").map(agent => ({
    eventId: `AGENT_FORECAST:${market}:${agent.name}:${candleAt}`,
    eventType: "AGENT_FORECAST", market, agent: agent.name,
    predictedSide: SIDES.has(agent.signal) ? agent.signal
      : SIDES.has(agent.direction) ? agent.direction : "NO_SIGNAL",
    forecastAt: candleAt, referenceClose: finite(close) ? close : null,
    referenceAtr: finite(atr14) ? atr14 : null, regime,
    evidence: agent.evidence ?? null, reason: agent.reason ?? null,
    outcomeHorizonBars: 12
  }));
}
