const SIDES = ["BUY", "SELL"];
const sideOf = frame => frame?.regime === "BULL_TREND" ? "BUY"
  : frame?.regime === "BEAR_TREND" ? "SELL"
  : Number.isFinite(frame?.close) && Number.isFinite(frame?.ema20) && Number.isFinite(frame?.ema50)
    ? frame.close > frame.ema50 && frame.ema20 > frame.ema50 ? "BUY"
      : frame.close < frame.ema50 && frame.ema20 < frame.ema50 ? "SELL" : null
    : null;

function add(points, side, expected, value, label, weight = 1) {
  if (side === expected) points[expected] += weight;
  if (side && side !== expected) points[expected === "BUY" ? "SELL" : "BUY"] += 0;
}

function momentumSide(frame) {
  if (Number.isFinite(frame?.macdHistogram) && frame.macdHistogram !== 0) {
    return frame.macdHistogram > 0 ? "BUY" : "SELL";
  }
  if (Number.isFinite(frame?.rsi14)) {
    if (frame.rsi14 >= 52) return "BUY";
    if (frame.rsi14 <= 48) return "SELL";
  }
  return null;
}

/**
 * Broad candidate discovery only. It may create a WATCHLIST candidate before
 * the M5 trigger forms, but it never approves a trade or changes risk gates.
 */
export function discoverSetups(frames = {}) {
  const h1 = sideOf(frames.H1), h4 = sideOf(frames.H4);
  const m15 = sideOf(frames.M15), m15Momentum = momentumSide(frames.M15);
  const candidates = [];

  for (const side of SIDES) {
    const opposite = side === "BUY" ? "SELL" : "BUY";
    const htf = [h1, h4].filter(value => value === side).length;
    const htfConflict = [h1, h4].some(value => value === opposite);
    if (htf === 0 || htfConflict) continue;

    const points = { BUY: 0, SELL: 0 };
    points[side] += htf * 2;
    if (m15 === side) points[side] += 2;
    if (m15Momentum === side) points[side] += 1;

    const m5 = frames.M5 ?? {};
    if (sideOf(m5) === side) points[side] += 1;
    if (m5.structure?.bos === (side === "BUY" ? "BULLISH" : "BEARISH")) points[side] += 2;
    if (m5.structure?.sweep === (side === "BUY" ? "BULLISH" : "BEARISH") ||
        (m5.structure?.sweepConfirmed === true &&
         m5.structure?.liquiditySweep === (side === "BUY" ? "BULLISH" : "BEARISH"))) points[side] += 2;

    const zoneDirection = side === "BUY" ? "BULLISH" : "BEARISH";
    const retest = (m5.smartMoney?.orderBlocks ?? []).some(zone =>
      zone.direction === zoneDirection && !zone.invalidated && !zone.mitigated &&
      Number.isFinite(zone.barsAgo) && zone.barsAgo >= 1 && zone.barsAgo <= 24
    ) || (m5.smartMoney?.fairValueGaps ?? []).some(zone =>
      zone.direction === zoneDirection && !zone.filled &&
      Number.isFinite(zone.barsAgo) && zone.barsAgo >= 1 && zone.barsAgo <= 24
    );
    if (retest) points[side] += 2;

    const close = m5.lastCandle?.close;
    const open = m5.lastCandle?.open;
    const high = m5.lastCandle?.high;
    const low = m5.lastCandle?.low;
    if ([open, close, high, low].every(Number.isFinite) && high > low) {
      const location = (close - low) / (high - low);
      if (side === "BUY" && close > open && location >= 0.65) points[side] += 1;
      if (side === "SELL" && close < open && location <= 0.35) points[side] += 1;
    }

    if (points[side] >= 5) candidates.push({
      direction: side,
      score: points[side],
      higherTimeframeAlignment: htf,
      setupType: m5.structure?.bos === (side === "BUY" ? "BULLISH" : "BEARISH")
        ? "BREAKOUT" : retest ? "PULLBACK" : "TREND_CONTINUATION",
      reasons: [
        htf ? `${htf} higher-timeframe trend(s) aligned` : null,
        m15 === side ? "M15 trend aligned" : null,
        m15Momentum === side ? "M15 momentum aligned" : null,
        m5.structure?.bos === (side === "BUY" ? "BULLISH" : "BEARISH") ? "M5 structure break" : null,
        retest ? "Fresh directional OB/FVG retest zone" : null
      ].filter(Boolean)
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0] ?? null;
  const ambiguous = candidates.length > 1 && candidates[0].score === candidates[1].score;
  return {
    candidate: best && !ambiguous ? best.direction : "HOLD",
    best: ambiguous ? null : best,
    candidates,
    status: best && !ambiguous ? "CANDIDATE_FOUND" : ambiguous ? "CONFLICTING_CANDIDATES" : "NO_SETUP",
    approval: "NOT_APPROVED — downstream verification and risk gates remain mandatory"
  };
}
