const SIDES = new Set(["BUY", "SELL"]);
const WEIGHTS = Object.freeze({
  higherTimeframe: 25,
  m15Momentum: 15,
  m5Trigger: 15,
  pocketOptionConfluence: 10,
  liquidityStructure: 15,
  quoteQuality: 10,
  volatilitySession: 10
});

const sideOf = frame => frame?.regime === "BULL_TREND" ||
  (Number.isFinite(frame?.close) && Number.isFinite(frame?.ema20) &&
   Number.isFinite(frame?.ema50) && frame.close > frame.ema50 && frame.ema20 > frame.ema50)
  ? "BUY" : frame?.regime === "BEAR_TREND" ||
  (Number.isFinite(frame?.close) && Number.isFinite(frame?.ema20) &&
   Number.isFinite(frame?.ema50) && frame.close < frame.ema50 && frame.ema20 < frame.ema50)
  ? "SELL" : null;

function candleTrigger(frame, side) {
  const c = frame?.lastCandle;
  if (!c || ![c.open, c.high, c.low, c.close].every(Number.isFinite) || !(c.high > c.low)) return null;
  const location = (c.close - c.low) / (c.high - c.low);
  return side === "BUY" ? c.close > c.open && location >= 0.65
    : c.close < c.open && location <= 0.35;
}

function component(name, weight, passed, available, detail) {
  return { name, weight, status: !available ? "UNAVAILABLE" : passed ? "PASS" : "FAIL", points: available && passed ? weight : 0, detail };
}

/**
 * Weighted technical score. Missing inputs never earn points. Hard safety
 * gates are evaluated separately and cannot be overridden by the score.
 */
export function scoreCandidate({ market, direction, frames = {}, marketReview = {}, quoteValidation = {}, spreadVerified = false, macroBlocked = false, staleTimeframes = [], a1Heart = null, externalAgentConsensus = null }) {
  const side = SIDES.has(direction) ? direction : null;
  const h1 = sideOf(frames.H1), h4 = sideOf(frames.H4);
  const htfAvailable = h1 !== null || h4 !== null;
  const htfPass = [h1, h4].filter(value => value === side).length >= 1 &&
    ![h1, h4].some(value => value && value !== side);
  const m15 = frames.M15 ?? {};
  const momentumAvailable = Number.isFinite(m15.macdHistogram) || Number.isFinite(m15.rsi14);
  const momentumPass = side === "BUY"
    ? (Number.isFinite(m15.macdHistogram) && m15.macdHistogram > 0) ||
      (Number.isFinite(m15.rsi14) && m15.rsi14 >= 52)
    : side === "SELL"
      ? (Number.isFinite(m15.macdHistogram) && m15.macdHistogram < 0) ||
        (Number.isFinite(m15.rsi14) && m15.rsi14 <= 48) : false;
  const pocket = frames.M5 ?? {};
  const confluenceVotes = [
    { name: "RSI", available: Number.isFinite(pocket.rsi14), direction: Number.isFinite(pocket.rsi14) ? (pocket.rsi14 > 50 ? "BUY" : pocket.rsi14 < 50 ? "SELL" : "NEUTRAL") : null },
    { name: "MACD", available: Number.isFinite(pocket.macdHistogram), direction: Number.isFinite(pocket.macdHistogram) ? (pocket.macdHistogram > 0 ? "BUY" : pocket.macdHistogram < 0 ? "SELL" : "NEUTRAL") : null },
    { name: "Stochastic", available: ["BULLISH", "BEARISH", "NEUTRAL"].includes(pocket.stochastic?.direction), direction: pocket.stochastic?.direction === "BULLISH" ? "BUY" : pocket.stochastic?.direction === "BEARISH" ? "SELL" : pocket.stochastic?.direction === "NEUTRAL" ? "NEUTRAL" : null },
    { name: "Candle streak", available: pocket.candleStreak?.direction !== "UNAVAILABLE" && typeof pocket.candleStreak?.direction === "string", direction: pocket.candleStreak?.direction === "BULLISH" ? "BUY" : pocket.candleStreak?.direction === "BEARISH" ? "SELL" : pocket.candleStreak?.direction === "NONE" ? "NEUTRAL" : null }
  ];
  const availableConfluence = confluenceVotes.filter(vote => vote.available);
  const alignedConfluence = availableConfluence.filter(vote => vote.direction === side).length;
  const confluenceAvailable = availableConfluence.length >= 3;
  const wickOpposes = pocket.rsiWick?.confirmed === true &&
    pocket.rsiWick.direction !== (side === "BUY" ? "BULLISH" : "BEARISH");
  const confluencePass = confluenceAvailable && alignedConfluence >= 3 && !wickOpposes;
  const triggerValue = marketReview?.m5?.confirmed;
  const triggerAvailable = typeof triggerValue === "boolean" || Boolean(frames.M5?.lastCandle);
  const triggerPass = typeof triggerValue === "boolean" ? triggerValue : candleTrigger(frames.M5, side) === true;
  const structure = frames.M5?.structure ?? {};
  const smartMoney = frames.M5?.smartMoney ?? {};
  const structureAvailable = Boolean(structure.bos || structure.sweep ||
    (Array.isArray(smartMoney.orderBlocks) && smartMoney.orderBlocks.length) ||
    (Array.isArray(smartMoney.fairValueGaps) && smartMoney.fairValueGaps.length));
  const pressure = marketReview?.orderFlow;
  const liquidityPass = Boolean(structure.sweep || structure.bos ||
    (pressure && pressure.direction === side && Number(pressure.strength) >= 2) ||
    (Array.isArray(smartMoney.orderBlocks) && smartMoney.orderBlocks.some(zone =>
      !zone.invalidated && zone.direction === (side === "BUY" ? "BULLISH" : "BEARISH"))));
  const quoteAvailable = quoteValidation?.valid === true && Number.isFinite(quoteValidation.spread);
  const spreadAtr = quoteAvailable && Number.isFinite(frames.M5?.atr14) && frames.M5.atr14 > 0
    ? quoteValidation.spread / frames.M5.atr14 : null;
  const spreadAtrLimit = market === "EURUSD" ? 0.12 : market === "BTCUSD" ? 0.18 : market === "XAUUSD" ? 0.15 : null;
  const volatilityAvailable = Number.isFinite(frames.M5?.atr14) && frames.M5.atr14 > 0 &&
    Number.isFinite(frames.M5?.atrBaseline) && frames.M5.atrBaseline > 0;
  const atrRatio = volatilityAvailable ? frames.M5.atr14 / frames.M5.atrBaseline : null;
  const volatilityPass = volatilityAvailable && atrRatio <= (market === "BTCUSD" ? 2.6 : market === "XAUUSD" ? 2.2 : 2.1);

  const components = [
    component("higher_timeframe_trend_and_structure", WEIGHTS.higherTimeframe, htfPass, htfAvailable, { H1: h1 ?? "UNAVAILABLE", H4: h4 ?? "UNAVAILABLE" }),
    component("M15_momentum", WEIGHTS.m15Momentum, momentumPass, momentumAvailable, { rsi14: m15.rsi14 ?? null, macdHistogram: m15.macdHistogram ?? null }),
    component("M5_closed_candle_trigger", WEIGHTS.m5Trigger, triggerPass, triggerAvailable, { confirmed: triggerAvailable ? triggerPass : null }),
    component("pocket_option_style_indicator_confluence", WEIGHTS.pocketOptionConfluence, confluencePass, confluenceAvailable, {
      votes: confluenceVotes.map(vote => ({ name: vote.name, direction: vote.direction ?? "UNAVAILABLE" })),
      aligned: alignedConfluence,
      required: 3,
      rsiWick: pocket.rsiWick ?? null,
      note: "Research-only confluence adapted from RSI/MACD/Stochastic/Candle Streak; no order execution authority"
    }),
    component("liquidity_and_SMC", WEIGHTS.liquidityStructure, liquidityPass, structureAvailable || Boolean(pressure), { bos: structure.bos ?? null, sweep: structure.sweep ?? null, pressure: pressure?.direction ?? "UNAVAILABLE" }),
    component("quote_and_spread", WEIGHTS.quoteQuality, spreadVerified === true, quoteAvailable, {
      spread: quoteValidation.spread ?? null,
      spreadAtr,
      spreadAtrLimit,
      passed: spreadVerified === true
    }),
    component("volatility_and_session", WEIGHTS.volatilitySession, volatilityPass, volatilityAvailable, { atrRatio })
  ];
  const score = components.reduce((sum, item) => sum + item.points, 0);
  const availableWeight = components.filter(item => item.status !== "UNAVAILABLE").reduce((sum, item) => sum + item.weight, 0);
  const coverage = availableWeight;
  const hardBlockers = [];
  if (!side) hardBlockers.push("No directional BUY/SELL discovery candidate");
  if (side && externalAgentConsensus !== null && externalAgentConsensus !== undefined) {
    if (externalAgentConsensus.approved !== true) {
      hardBlockers.push("Five-agent confirmation quorum not met: " + (externalAgentConsensus.counts ? JSON.stringify(externalAgentConsensus.counts) : "agent consensus unavailable"));
    } else if (externalAgentConsensus.direction !== side) {
      hardBlockers.push("Five-agent consensus direction does not match primary candidate");
    }
  }
  const advisories = [];
  // A1 HEART is a distinct opening-range/volume-profile strategy, not a
  // universal prerequisite for every trend, VWAP, SMC or retest candidate.
  // Requiring it globally silently vetoes otherwise valid BTC/XAU candidates
  // whenever its session-specific volume pattern is absent. Keep its state
  // visible as an advisory; a candidate selected explicitly from A1 HEART must
  // pass that strategy's own READY/direction check before it can be approved.
  if (a1Heart?.status !== "READY" || a1Heart?.direction !== side) {
    advisories.push("A1 HEART is not confirmed for this direction; this only disables the A1 HEART setup family and does not veto independent strategy candidates.");
  }
  if (macroBlocked) hardBlockers.push("Macro/event-risk hard gate is active");
  if (staleTimeframes.length) hardBlockers.push("Stale timeframe data: " + staleTimeframes.join(", "));
  if (!spreadVerified) {
    hardBlockers.push("Fresh bid/ask and market-specific spread/ATR check did not pass");
    if (spreadAtr !== null && spreadAtrLimit !== null && spreadAtr > spreadAtrLimit) {
      hardBlockers.push("Spread/ATR " + spreadAtr.toFixed(4) + " exceeds " + market + " limit " + spreadAtrLimit);
    } else if (spreadAtr === null) {
      hardBlockers.push("Spread/ATR could not be calculated from a valid quote and M5 ATR");
    }
  }
  if (!triggerAvailable || !triggerPass) hardBlockers.push("Required closed M5 entry trigger is not confirmed");
  const status = hardBlockers.length ? "REJECTED"
    : score >= 75 && coverage >= 70 ? "ELIGIBLE_FOR_RISK_GATE"
      : score >= 65 && coverage >= 70 ? "WATCHLIST" : "REJECTED";
  return {
    market, direction: side ?? "NO SETUP", score, candidateStrength: score, coverage, maxScore: 100,
    decision: "CANDIDATE_ONLY", approved: false, riskApprovalRequired: true,
    threshold: { eligible: 75, watchlist: 65, minimumCoverage: 70 },
    components, hardBlockers, advisories, status,
    note: "Candidate strength only; this score never approves a trade. Independent quote, news, entry and risk gates must approve separately."
  };
}

export { WEIGHTS as DECISION_SCORE_WEIGHTS };
