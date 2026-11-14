/**
 * Five independent, deterministic market-data agents for Forex Sniper.
 * Original transparent adapters inspired by public methodology descriptions.
 * They do not import or claim to reproduce upstream proprietary MT4 code.
 *
 * Each agent returns BUY, SELL, or NO_SIGNAL from closed candles and (where
 * required) a provider-validated bid/ask quote. A 3-of-5 directional quorum
 * is an additional confirmation gate, never a substitute for entry/risk gates.
 * The chronological final 30% holdout remains locked until settings are frozen.
 */

import { buildAdaptiveAgentWeights } from "./adaptive-agent-weights.js";

const SIDES = new Set(["BUY", "SELL"]);
const valid = value => value !== null && value !== undefined && Number.isFinite(Number(value));
const side = delta => !valid(delta) || delta === 0 ? "NO_SIGNAL" : delta > 0 ? "BUY" : "SELL";
const sma = (values, period) => values.length < period ? null : values.slice(-period).every(valid)
  ? values.slice(-period).reduce((sum, value) => sum + value, 0) / period : null;

function signalAgent(name, direction, evidence, reason) {
  const signal = SIDES.has(direction) ? direction : "NO_SIGNAL";
  return { name, signal, direction: signal, status: signal === "NO_SIGNAL" ? "NO_SIGNAL" : "DIRECTIONAL_SIGNAL", evidence, reason };
}

function confirmedSwings(candles, left = 2, right = 2) {
  const highs = [], lows = [];
  for (let i = left; i < candles.length - right; i++) {
    const window = candles.slice(i - left, i + right + 1);
    if (window.every((c, j) => j === left || candles[i].high > c.high)) highs.push({ index: i, price: candles[i].high });
    if (window.every((c, j) => j === left || candles[i].low < c.low)) lows.push({ index: i, price: candles[i].low });
  }
  return { highs, lows };
}

// Agent 1 — hpFX-inspired multi-timeframe role separation.
function hpfxAgent(frames) {
  const rows = ["M5", "M15", "H1", "H4"].map(tf => ({ tf, frame: frames[tf] })).filter(x => x.frame);
  const votes = rows.map(({ tf, frame }) => ({
    timeframe: tf,
    trend: valid(frame.ema20) && valid(frame.ema50) ? side(frame.ema20 - frame.ema50) : "NO_SIGNAL",
    momentum: valid(frame.macd) && valid(frame.macdSignal) ? side(frame.macd - frame.macdSignal) : "NO_SIGNAL",
    tradeableVolatility: valid(frame.atr14) && frame.atr14 > 0 && (!valid(frame.adx14) || frame.adx14 >= 15)
  }));
  const m5 = votes.find(v => v.timeframe === "M5");
  const higher = votes.filter(v => ["M15", "H1", "H4"].includes(v.timeframe));
  const confirmations = higher.filter(v => v.trend === m5?.trend && v.momentum === m5?.trend).length;
  const direction = m5 && SIDES.has(m5.trend) && m5.momentum === m5.trend &&
    m5.tradeableVolatility && confirmations >= 1 ? m5.trend : "NO_SIGNAL";
  return signalAgent("hpFX multi-timeframe", direction, { votes, higherTimeframeConfirmations: confirmations },
    "M5 trend and momentum must align, with at least one higher timeframe confirming both.");
}

// Agent 2 — ICT/SMC: confirmed structure shift plus same-direction unfilled FVG.
function smcAgent(candles) {
  if (candles.length < 20) return signalAgent("ICT/SMC structure", "NO_SIGNAL", { history: candles.length }, "Insufficient closed candles.");
  const swings = confirmedSwings(candles);
  const last = candles.at(-1);
  const priorHigh = [...swings.highs].reverse().find(p => p.index < candles.length - 1);
  const priorLow = [...swings.lows].reverse().find(p => p.index < candles.length - 1);
  const mss = priorHigh && last.close > priorHigh.price ? "BUY"
    : priorLow && last.close < priorLow.price ? "SELL" : "NO_SIGNAL";
  let fvg = null;
  for (let i = candles.length - 1; i >= Math.max(2, candles.length - 12); i--) {
    const a = candles[i - 2], c = candles[i];
    if (c.low > a.high) { fvg = { direction: "BUY", lower: a.high, upper: c.low, index: i }; break; }
    if (c.high < a.low) { fvg = { direction: "SELL", lower: c.high, upper: a.low, index: i }; break; }
  }
  const unfilled = fvg && (fvg.direction === "BUY" ? last.close > fvg.upper : last.close < fvg.lower);
  const direction = SIDES.has(mss) && unfilled && fvg.direction === mss ? mss : "NO_SIGNAL";
  return signalAgent("ICT/SMC structure", direction, { marketStructureShift: mss, fairValueGap: fvg, gapUnfilled: Boolean(unfilled), swingHigh: priorHigh?.price ?? null, swingLow: priorLow?.price ?? null },
    "Requires a confirmed break of structure and a same-direction unfilled fair-value gap.");
}

// Agent 3 — FxTT-inspired scanner: momentum, trend, ADX and real quote cost.
function scannerAgent(m5, quoteValidation, market) {
  const spreadAtr = valid(quoteValidation?.spread) && valid(m5?.atr14) && m5.atr14 > 0
    ? quoteValidation.spread / m5.atr14 : null;
  const limit = market === "BTCUSD" ? 0.18 : market === "XAUUSD" ? 0.15 : 0.12;
  const spreadPass = quoteValidation?.valid === true && valid(spreadAtr) && spreadAtr <= limit;
  const adxPass = valid(m5?.adx14) && m5.adx14 >= 18;
  const rsi = valid(m5?.rsi14) ? (m5.rsi14 >= 55 ? "BUY" : m5.rsi14 <= 45 ? "SELL" : "NO_SIGNAL") : "NO_SIGNAL";
  const trend = valid(m5?.ema20) && valid(m5?.ema50) ? side(m5.ema20 - m5.ema50) : "NO_SIGNAL";
  const direction = spreadPass && adxPass && rsi === trend && SIDES.has(trend) ? trend : "NO_SIGNAL";
  return signalAgent("FxTT market scanner", direction, { spreadAtr, spreadLimit: limit, spreadPass, adx: m5?.adx14 ?? null, adxPass, rsi: m5?.rsi14 ?? null, rsiDirection: rsi, trendDirection: trend },
    "Requires valid quote cost, acceptable spread/ATR, ADX >= 18 and aligned RSI/trend.");
}

// Agent 4 — Gann/Hurst-inspired trailing trend and octave location.
function gannAgent(candles) {
  if (candles.length < 128) return signalAgent("Gann/Hurst trend", "NO_SIGNAL", { history: candles.length }, "At least 128 closed candles required.");
  const closes = candles.map(c => c.close);
  const ma32 = sma(closes, 32), ma64 = sma(closes, 64), ma128 = sma(closes, 128);
  const high = Math.max(...candles.slice(-64).map(c => c.high));
  const low = Math.min(...candles.slice(-64).map(c => c.low));
  const octave = (high - low) / 8;
  const price = closes.at(-1);
  const direction = ma32 > ma64 && ma64 > ma128 && price > low + octave * 4 ? "BUY"
    : ma32 < ma64 && ma64 < ma128 && price < low + octave * 4 ? "SELL" : "NO_SIGNAL";
  return signalAgent("Gann/Hurst trend", direction, { ma32, ma64, ma128, octaveMidpoint: low + octave * 4, price, rangeLow: low, rangeHigh: high },
    "Trailing MA32/64/128 alignment plus price location relative to the 64-bar octave midpoint; no future-centred averages.");
}

// Agent 5 — systematic trend/momentum breakout agent (FX Strategy Framework-inspired).
function systematicAgent(candles) {
  if (candles.length < 65) return signalAgent("Systematic breakout", "NO_SIGNAL", { history: candles.length }, "At least 65 closed candles required.");
  const last = candles.at(-1);
  const prior = candles.slice(-21, -1);
  const priorHigh = Math.max(...prior.map(c => c.high));
  const priorLow = Math.min(...prior.map(c => c.low));
  const closes = candles.map(c => c.close);
  const fast = sma(closes, 20), slow = sma(closes, 50);
  const direction = last.close > priorHigh && fast > slow ? "BUY"
    : last.close < priorLow && fast < slow ? "SELL" : "NO_SIGNAL";
  return signalAgent("Systematic breakout", direction, { close: last.close, prior20High: priorHigh, prior20Low: priorLow, sma20: fast, sma50: slow },
    "Requires a closed-candle 20-bar range breakout aligned with trailing SMA20/SMA50 trend.");
}

function validationFramework(candles) {
  const count = candles.length, trainEnd = Math.floor(count * 0.7);
  return {
    status: count >= 100 ? "TRAINING_WINDOW_ONLY" : "INSUFFICIENT_HISTORY",
    totalClosedCandles: count,
    trainingRange: { startIndex: 0, endIndexExclusive: trainEnd, count: trainEnd },
    holdoutRange: { startIndex: trainEnd, endIndexExclusive: count, count: count - trainEnd },
    holdoutAccess: "LOCKED_UNTIL_CANDIDATE_SETTINGS_FROZEN",
    requiredValidation: ["chronological walk-forward", "realistic spread/commission/slippage", "minimum 30 resolved trades", "forward paper test"],
    optimizationApplied: false
  };
}

export function evaluateGithubResearchIntegrations({ frames, candles, quoteValidation = null, market = "EURUSD", agentOutcomes = [], agentTrainingCutoff = null }) {
  const agents = [
    hpfxAgent(frames),
    smcAgent(candles),
    scannerAgent(frames.M5, quoteValidation, market),
    gannAgent(candles),
    systematicAgent(candles)
  ];
  const adaptiveCalibration = buildAdaptiveAgentWeights({ market, outcomes: agentOutcomes, trainingCutoff: agentTrainingCutoff });
  for (const agent of agents) {
    const learned = adaptiveCalibration.weights?.[agent.name]?.[agent.signal];
    agent.baseWeight = 1;
    agent.calibration = learned ?? {
      status: adaptiveCalibration.enabled ? "INSUFFICIENT_SIDE_SAMPLE" : "BASELINE_UNCALIBRATED",
      sampleSize: 0, multiplier: 1
    };
    agent.weight = learned?.multiplier ?? 1;
  }
  const counts = { BUY: agents.filter(a => a.signal === "BUY").length, SELL: agents.filter(a => a.signal === "SELL").length, NO_SIGNAL: agents.filter(a => a.signal === "NO_SIGNAL").length };
  const weightedScores = {
    BUY: agents.filter(a => a.signal === "BUY").reduce((sum, agent) => sum + agent.weight, 0),
    SELL: agents.filter(a => a.signal === "SELL").reduce((sum, agent) => sum + agent.weight, 0)
  };
  const totalDirectionalWeight = weightedScores.BUY + weightedScores.SELL;
  const direction = weightedScores.BUY > weightedScores.SELL ? "BUY"
    : weightedScores.SELL > weightedScores.BUY ? "SELL" : "NO_SIGNAL";
  const support = direction === "NO_SIGNAL" ? 0 : counts[direction];
  const weightedAgreementPct = totalDirectionalWeight > 0 && direction !== "NO_SIGNAL"
    ? weightedScores[direction] / totalDirectionalWeight * 100 : 0;
  const approved = support >= 3 && weightedAgreementPct >= 60;
  const consensus = {
    direction: approved ? direction : "NO_SIGNAL",
    approved,
    requiredVotes: 3,
    totalAgents: 5,
    counts,
    weightedScores,
    weightedAgreementPct: Number(weightedAgreementPct.toFixed(2)),
    agreementPct: support / 5 * 100,
    rule: "At least 3 of 5 independent agents and at least 60% of directional reliability-weighted support must agree; otherwise NO_SIGNAL."
  };
  return {
    generatedAt: new Date().toISOString(),
    mode: "PAPER_RESEARCH_ONLY",
    primaryProvider: "FOREX_SNIPER",
    agents,
    consensus,
    adaptiveCalibration,
    validationFramework: validationFramework(candles),
    governance: {
      agentQuorumRequiredForCandidateAdvancement: true,
      mayApproveFinalTrade: false,
      mayOverrideRiskGates: false,
      closedCandlesOnly: true,
      holdoutProtected: true,
      brokerExecutionEnabled: false,
      note: "The five agents produce directional research signals. Their quorum is confirmation only; final approval still requires Forex Sniper quote, entry, spread, calendar, stop-loss, take-profit and risk gates."
    }
  };
}
