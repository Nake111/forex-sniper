import { scoreInstitutionalSetup, hasDirectionalRetest } from "./signal.js";

const SIDES = ["BUY", "SELL"];

function directionOf(regime) {
  return regime === "BULL_TREND" ? "BUY" : regime === "BEAR_TREND" ? "SELL" : "HOLD";
}

/**
 * Balanced tiered decision layer:
 * A+ requires score >= 10 and a 4-point lead; B requires >= 7 and a 2-point lead.
 * Tier B is still subject to H1 momentum, deterministic-agent, Gemini (when
 * configured), data-age and macro risk gates in the main pipeline.
 */
export function evaluateTieredSignal(frames, macro = {}) {
  const score = scoreInstitutionalSetup(frames, macro);
  const bull = score.bullishScore ?? 0;
  const bear = score.bearishScore ?? 0;
  const gap = Math.abs(bull - bear);
  const side = bull > bear ? "BUY" : bear > bull ? "SELL" : "HOLD";
  const strength = Math.max(bull, bear);
  const blocked = macro.eventRisk === "HIGH" || macro.dataStale === true;
  const tier = !blocked && strength >= 10 && gap >= 4 ? "A+"
    : !blocked && strength >= 7 && gap >= 2 ? "B" : "C";
  const signal = !blocked && SIDES.includes(side) && tier !== "C" ? side : "HOLD";

  const frame = frames?.M5 ?? {};
  const higherDirection = directionOf(frames?.H1?.regime);
  const sweep = frame.structure?.sweep === (signal === "BUY" ? "BULLISH" : "BEARISH") ||
    (frame.structure?.sweepConfirmed === true &&
      frame.structure?.liquiditySweep === (signal === "BUY" ? "BULLISH" : "BEARISH"));
  const retest = signal !== "HOLD" && hasDirectionalRetest(frame, signal === "BUY" ? "BULLISH" : "BEARISH", 12);
  const setupType = signal === "HOLD" ? "NONE"
    : (sweep || (higherDirection !== "HOLD" && higherDirection !== signal) || retest)
      ? "PULLBACK_OR_REVERSAL" : "TREND_CONTINUATION";

  return {
    signal, tier, setupType,
    bullishScore: bull, bearishScore: bear, scoreGap: gap,
    scoreScale: score.scoreScale ?? 26,
    reasons: score.reasons ?? [],
    blockedReason: blocked ? (macro.eventRisk === "HIGH" ? "High-impact event risk" : "Stale market data") : null
  };
}
