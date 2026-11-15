const SIDES = new Set(["BUY", "SELL", "HOLD"]);
const DIRECTIONS = new Set(["BULLISH", "BEARISH"]);

function toSide(value) {
  return value === "BULLISH" ? "BUY" : value === "BEARISH" ? "SELL" : "HOLD";
}

export function marketAwareMacroDirection(market, macro = {}) {
  const explicit = macro.marketBias?.[market] ?? ({
    EURUSD: macro.eurusdMacroBias,
    GBPUSD: macro.gbpusdMacroBias,
    USDJPY: macro.usdjpyMacroBias,
    XAUUSD: macro.goldMacroBias,
    BTCUSD: macro.btcMacroBias
  })[market];
  return toSide(explicit);
}

export function validateSmcPriceEvidence(candles, frame = {}) {
  const structure = frame.structure ?? {};
  const direction = toSide(structure.bos);
  const no = reason => ({ direction: "HOLD", valid: false, reason });
  if (!Array.isArray(candles) || candles.length < 20) return no("Insufficient closed OHLC history for structural validation");
  if (direction === "HOLD" || !DIRECTIONS.has(structure.bos)) return no("No directional BOS from the closed-candle structure engine");
  if (!Number.isFinite(structure.bosLevel) || !Number.isFinite(structure.bosBarsAgo) || structure.bosBarsAgo > 3) {
    return no("BOS level missing or break is older than three closed candles");
  }
  const last = candles.at(-1);
  const previous = candles.at(-2);
  const values = [last.open, last.high, last.low, last.close, previous.close].map(Number);
  if (!values.every(Number.isFinite) || !(values[1] > values[2])) return no("Latest closed OHLC candle is invalid");
  const [open, high, low, close, previousClose] = values;
  const level = Number(structure.bosLevel);
  const crossed = direction === "BUY"
    ? previousClose <= level && close > level
    : previousClose >= level && close < level;
  // The structural engine may report a recent break before the latest candle.
  // Verify that the latest close still holds on the correct side of the broken level.
  const holdsBreak = direction === "BUY" ? close > level : close < level;
  if (!holdsBreak || (!crossed && structure.bosBarsAgo === 0)) return no("Latest closed price does not validate the reported BOS level");
  const bodies = candles.slice(-11, -1).map(c => Math.abs(Number(c.close) - Number(c.open))).filter(Number.isFinite);
  if (bodies.length < 6) return no("Insufficient prior candle bodies to measure displacement");
  const averageBody = bodies.reduce((sum, value) => sum + value, 0) / bodies.length;
  const body = Math.abs(close - open);
  const closePosition = (close - low) / (high - low);
  const directionalBody = direction === "BUY" ? close > open && closePosition >= 0.65
    : close < open && closePosition <= 0.35;
  if (!(averageBody > 0) || body < averageBody * 1.25 || !directionalBody) {
    return no("No directional displacement candle (body must be at least 1.25x recent average)");
  }
  const sweepConfirmed = structure.sweepConfirmed === true &&
    toSide(structure.liquiditySweep) === direction &&
    Number.isFinite(structure.liquiditySweepBarsAgo) && structure.liquiditySweepBarsAgo <= 3;
  const retest = [
    ...(frame.smartMoney?.orderBlocks ?? []).filter(z => z.direction === (direction === "BUY" ? "BULLISH" : "BEARISH") && !z.invalidated),
    ...(frame.smartMoney?.fairValueGaps ?? []).filter(z => z.direction === (direction === "BUY" ? "BULLISH" : "BEARISH") && !z.filled)
  ].some(zone => {
    const top = Number(zone.high ?? zone.top);
    const bottom = Number(zone.low ?? zone.bottom);
    const midpoint = Number(zone.midpoint ?? ((top + bottom) / 2));
    if (![top, bottom, midpoint].every(Number.isFinite) || top < bottom) return false;
    const overlaps = low <= top && high >= bottom;
    return overlaps && (direction === "BUY" ? close > midpoint : close < midpoint);
  });
  if (!sweepConfirmed && !retest) return no("BOS lacks a matching confirmed liquidity sweep or valid OB/FVG retest");
  return {
    direction, valid: true,
    reason: `Closed-price BOS + ${body / averageBody >= 1.25 ? "displacement" : "no displacement"} + ${sweepConfirmed ? "confirmed sweep" : "OB/FVG retest"}`,
    bosLevel: level, bodyToAverage: Number((body / averageBody).toFixed(2)),
    closePosition: Number(closePosition.toFixed(3)), sweepConfirmed, retest
  };
}

export function classifyVolumeEvidence(frame = {}) {
  const source = String(frame.volumeProvenance ?? frame.volumeSource ?? frame.volumeType ?? "UNVERIFIED").toUpperCase();
  const trusted = ["EXCHANGE_TRADE_VOLUME", "REAL_TRADE_VOLUME", "CONSOLIDATED_TRADE_VOLUME"].includes(source);
  return {
    trusted, source: trusted ? source : "UNVERIFIED_OR_TICK_VOLUME_PROXY",
    direction: trusted ? (frame.cvd?.direction === "BUYING" ? "BUY" : frame.cvd?.direction === "SELLING" ? "SELL" : "HOLD") : "HOLD",
    reason: trusted
      ? "Volume source explicitly identifies trade volume; CVD may be used as supporting evidence"
      : "Volume provenance is not verified as real trade volume; VWAP/POC/CVD cannot cast a directional volume vote"
  };
}

function parseTime(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Diagnostics include abstentions so missed opportunities are visible.
// Only observations at or before the frozen training cutoff are eligible.
export function evaluateAgentHistoricalPerformance(outcomes = [], trainingCutoff = null, market = null) {
  const cutoff = parseTime(trainingCutoff);
  const rows = Array.isArray(outcomes) && cutoff !== null ? outcomes.filter(row =>
    row?.eventType === "AGENT_FORECAST_OUTCOME" &&
    (market === null || row.market === market) &&
    typeof row.agent === "string" && SIDES.has(row.predictedSide) &&
    ["BUY", "SELL", "FLAT"].includes(row.actualDirection) &&
    parseTime(row.forecastAt) !== null && parseTime(row.forecastAt) <= cutoff
  ) : [];
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.agent)) grouped.set(row.agent, []);
    grouped.get(row.agent).push(row);
  }
  const agents = {};
  for (const [name, sample] of grouped) {
    const tp = sample.filter(r => r.predictedSide === r.actualDirection && r.predictedSide !== "HOLD").length;
    const fp = sample.filter(r => r.predictedSide !== "HOLD" && r.predictedSide !== r.actualDirection).length;
    const fn = sample.filter(r => r.predictedSide === "HOLD" && r.actualDirection !== "FLAT").length;
    const tn = sample.filter(r => r.predictedSide === "HOLD" && r.actualDirection === "FLAT").length;
    agents[name] = {
      sampleSize: sample.length, trueSignals: tp, falseSignals: fp,
      missedOpportunities: fn, correctAbstentions: tn,
      precisionPct: tp + fp ? Number((100 * tp / (tp + fp)).toFixed(2)) : null,
      recallPct: tp + fn ? Number((100 * tp / (tp + fn)).toFixed(2)) : null,
      falseSignalRatePct: tp + fp ? Number((100 * fp / (tp + fp)).toFixed(2)) : null
    };
  }
  return {
    status: cutoff === null ? "DISABLED_NO_FROZEN_CUTOFF" : "TRAINING_ONLY",
    trainingCutoff: cutoff === null ? null : new Date(cutoff).toISOString(),
    holdoutUsed: false, resolvedObservations: rows.length, agents
  };
}
