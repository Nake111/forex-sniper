const SIDES = new Set(["BUY", "SELL"]);
const MIN_SIDE_SAMPLE = 30;
const PRIOR_CORRECT = 10;
const PRIOR_INCORRECT = 10;
const MIN_MULTIPLIER = 0.75;
const MAX_MULTIPLIER = 1.25;

function timestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

/**
 * Build conservative, market- and side-specific agent multipliers.
 * Only explicitly frozen training observations are eligible. The holdout is
 * not scored, summarized, or used to choose weights.
 */
export function buildAdaptiveAgentWeights({
  market,
  outcomes = [],
  trainingCutoff = null,
  minSideSample = MIN_SIDE_SAMPLE
} = {}) {
  const cutoff = timestamp(trainingCutoff);
  const empty = {
    enabled: false,
    market: market ?? "UNKNOWN",
    trainingCutoff: cutoff === null ? null : new Date(cutoff).toISOString(),
    minimumResolvedPerSide: minSideSample,
    prior: { correct: PRIOR_CORRECT, incorrect: PRIOR_INCORRECT },
    weights: {},
    reason: cutoff === null
      ? "Frozen AGENT_TRAINING_CUTOFF is not configured; neutral baseline weights retained."
      : "No eligible training-only agent outcomes before the frozen cutoff."
  };
  if (cutoff === null || !Array.isArray(outcomes)) return empty;

  const eligible = outcomes.filter(row =>
    row?.eventType === "AGENT_FORECAST_OUTCOME" &&
    row.market === market &&
    typeof row.agent === "string" &&
    SIDES.has(row.predictedSide) &&
    ["BUY", "SELL", "FLAT"].includes(row.actualDirection) &&
    timestamp(row.forecastAt) !== null &&
    timestamp(row.forecastAt) <= cutoff
  );

  const grouped = new Map();
  for (const row of eligible) {
    if (!grouped.has(row.agent)) grouped.set(row.agent, { BUY: [], SELL: [] });
    grouped.get(row.agent)[row.predictedSide].push(row);
  }

  const weights = {};
  for (const [agent, sides] of grouped) {
    weights[agent] = {};
    for (const side of ["BUY", "SELL"]) {
      const sample = sides[side];
      if (sample.length < minSideSample) continue;
      const correct = sample.filter(row => row.actualDirection === side).length;
      const accuracy = correct / sample.length;
      // Beta(10,10) shrinkage limits overreaction to a short streak.
      const posterior = (correct + PRIOR_CORRECT) /
        (sample.length + PRIOR_CORRECT + PRIOR_INCORRECT);
      const multiplier = clamp(1 + (posterior - 0.5), MIN_MULTIPLIER, MAX_MULTIPLIER);
      weights[agent][side] = {
        status: "TRAINING_CALIBRATED",
        sampleSize: sample.length,
        correct,
        falseSignals: sample.length - correct,
        accuracyPct: Number((accuracy * 100).toFixed(2)),
        posteriorAccuracyPct: Number((posterior * 100).toFixed(2)),
        multiplier: Number(multiplier.toFixed(3))
      };
    }
    if (!Object.keys(weights[agent]).length) delete weights[agent];
  }

  const calibratedSides = Object.values(weights).reduce((sum, item) => sum + Object.keys(item).length, 0);
  return {
    enabled: calibratedSides > 0,
    market,
    trainingCutoff: new Date(cutoff).toISOString(),
    minimumResolvedPerSide: minSideSample,
    prior: { correct: PRIOR_CORRECT, incorrect: PRIOR_INCORRECT },
    weights,
    calibratedAgentSides: calibratedSides,
    reason: calibratedSides
      ? "Weights use only resolved, market-matched training forecasts at or before the frozen cutoff; holdout excluded."
      : "Training evidence has not reached the minimum resolved sample for any agent/side; neutral baseline weights retained."
  };
}
