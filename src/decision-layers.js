const DIRECTIONS = new Set(["BUY", "SELL"]);
const TIMEFRAMES = ["M5", "M15", "H1", "H4"];

function timeframeBias(frame) {
  if (!frame) return "UNAVAILABLE";
  if (frame.regime === "BULL_TREND" ||
      (Number.isFinite(frame.close) && Number.isFinite(frame.ema20) &&
       Number.isFinite(frame.ema50) && frame.close > frame.ema50 && frame.ema20 > frame.ema50)) return "BUY";
  if (frame.regime === "BEAR_TREND" ||
      (Number.isFinite(frame.close) && Number.isFinite(frame.ema20) &&
       Number.isFinite(frame.ema50) && frame.close < frame.ema50 && frame.ema20 < frame.ema50)) return "SELL";
  return "MIXED";
}

/**
 * Layer 1 is deliberately read-only: it records the technical engine's
 * directional candidate and M5/M15/H1/H4 context. Later gates cannot rewrite it.
 */
export function buildDiscoveryLayer({ market, candidate, frames = {}, source = "technical-engine" }) {
  const validCandidate = DIRECTIONS.has(candidate) ? candidate : "NO SETUP";
  return {
    layer: 1,
    name: "SIGNAL_DISCOVERY",
    market,
    candidate: validCandidate,
    source,
    timeframes: Object.fromEntries(TIMEFRAMES.map(tf => [tf, timeframeBias(frames[tf])])),
    status: validCandidate === "NO SETUP" ? "NO SETUP FOUND" : "CANDIDATE FOUND",
    immutable: true
  };
}

/**
 * Layer 2 reports independent checks without changing Layer 1's candidate.
 * UNAVAILABLE is distinct from FAIL and is never silently treated as PASS.
 */
export function buildVerificationLayer({
  discovery,
  marketReview,
  deterministicFallback,
  agentGate,
  llmReport,
  staleTimeframes = [],
  macroBlocked = false,
  spreadVerified = null
}) {
  const candidate = discovery?.candidate;
  const higherTimeframeDirection = marketReview?.trend?.direction ?? marketReview?.squeeze?.h1Trend ?? marketReview?.direction ?? null;
  const trendStatus = !higherTimeframeDirection || higherTimeframeDirection === "MIXED"
    ? "UNAVAILABLE" : higherTimeframeDirection === candidate ? "PASS" : "FAIL";
  const triggerConfirmed = marketReview?.m5?.confirmed;
  const momentumStatus = typeof triggerConfirmed !== "boolean" ? "UNAVAILABLE" : triggerConfirmed ? "PASS" : "FAIL";
  const pressure = marketReview?.orderFlow;
  const liquidityStatus = !pressure || pressure.direction === "UNKNOWN" ? "ADVISORY"
    : pressure.strength < 2 ? "ADVISORY"
      : pressure.direction === candidate ? "PASS" : "FAIL";
  const checks = [
    { name: "higher_timeframe_trend_alignment", status: trendStatus, reasons: trendStatus === "FAIL" ? ["Higher-timeframe direction conflicts with discovery candidate"] : [] },
    { name: "m5_momentum_and_trigger", status: momentumStatus, reasons: momentumStatus === "FAIL" ? ["M5 momentum/closed-candle trigger is not confirmed"] : [] },
    { name: "market_structure_and_liquidity", status: marketReview?.approved ? "PASS" : marketReview ? "FAIL" : "UNAVAILABLE", reasons: marketReview?.blockers ?? [] },
    { name: "buyer_seller_pressure", status: liquidityStatus, reasons: liquidityStatus === "FAIL" ? ["Buyer/seller pressure conflicts with candidate"] : [] },
    { name: "deterministic_market_rules", status: deterministicFallback?.approved ? "PASS" : deterministicFallback ? "FAIL" : "UNAVAILABLE", reasons: deterministicFallback?.reasons ?? deterministicFallback?.blockers ?? [] },
    { name: "multi_agent_confluence", status: agentGate?.approved ? "PASS" : deterministicFallback?.approved ? "ADVISORY" : agentGate ? "FAIL" : "UNAVAILABLE", reasons: agentGate?.reasons ?? (agentGate?.reason ? [agentGate.reason] : []) },
    { name: "candle_freshness", status: staleTimeframes.length ? "FAIL" : "PASS", reasons: staleTimeframes.length ? ["Stale timeframes: " + staleTimeframes.join(", ")] : [] },
    { name: "macro_event_risk", status: macroBlocked ? "FAIL" : "PASS", reasons: macroBlocked ? ["Macro/calendar/news risk gate is active"] : [] },
    { name: "spread", status: spreadVerified === null ? "UNAVAILABLE" : spreadVerified ? "PASS" : "FAIL", reasons: spreadVerified === false ? ["Spread or spread/ATR validation failed"] : [] },
    { name: "optional_llm_review", status: llmReport?.status === "COMPLETE" ? "REVIEWED" : "UNAVAILABLE", reasons: llmReport?.status && llmReport.status !== "COMPLETE" ? ["Optional LLM review: " + llmReport.status + "; deterministic checks remain authoritative"] : [] }
  ];
  const required = checks.filter(check => !["optional_llm_review", "multi_agent_confluence"].includes(check.name));
  const failed = required.filter(check => check.status === "FAIL" || check.status === "UNAVAILABLE");\n  if (weightedScore) {\n    const hard = [...(weightedScore.hardBlockers ?? []), ...(macroBlocked ? ["Macro/event-risk hard gate is active"] : []), ...(staleTimeframes.length ? ["Stale timeframe data: " + staleTimeframes.join(", ")] : [])];\n    return { layer: 2, name: "INDEPENDENT_VERIFICATION", market: discovery?.market ?? marketReview?.market ?? "UNKNOWN", candidate, status: weightedScore.status === "ELIGIBLE_FOR_RISK_GATE" && hard.length === 0 ? "PASSED" : "REJECTED", score: weightedScore.score, coverage: weightedScore.coverage, components: weightedScore.components, checks, blockers: [...new Set([...hard, ...(weightedScore.status === "WATCHLIST" ? ["Weighted score below 75-point approval threshold"] : [])])], candidatePreserved: true };\n  }
  return {
    layer: 2,
    name: "INDEPENDENT_VERIFICATION",
    market: discovery?.market ?? marketReview?.market ?? "UNKNOWN",
    candidate,
    status: failed.length ? "REJECTED" : "PASSED",
    checks,
    blockers: failed.flatMap(check => check.reasons.length ? check.reasons : [check.name + " " + check.status]),
    candidatePreserved: true
  };
}

/**
 * Layer 3 approves a paper/reference signal only when all execution checks pass.
 * Actual broker execution remains denied until a venue/account is explicitly
 * connected and independently verified.
 */
export function buildExecutionLayer({
  discovery,
  verification,
  plan,
  quote,
  quoteValidation,
  approval,
  entryVerification,
  executionVenueConnected = false
}) {
  const candidate = discovery?.candidate;
  const blockers = [
    ...(verification?.status === "PASSED" ? [] : ["Layer 2 verification did not pass"]),
    ...(approval?.approved ? [] : approval?.blockers ?? ["Signal approval did not pass"]),
    ...(entryVerification?.approved ? [] : entryVerification?.blockers ?? ["Entry verification did not pass"]),
    ...(plan ? [] : ["Entry/SL/TP plan unavailable"]),
    ...(quoteValidation?.valid ? [] : [quoteValidation?.reason ?? "Fresh bid/ask validation failed"]),
    ...(quote && Number.isFinite(quote.bid) && Number.isFinite(quote.ask) && quote.ask > quote.bid ? [] : ["Valid uncrossed bid/ask is unavailable"]),
    ...(executionVenueConnected ? [] : ["Broker execution venue/account is not connected and verified"])
  ];
  const paperApproved = DIRECTIONS.has(candidate) && blockers.length === 1 &&
    blockers[0] === "Broker execution venue/account is not connected and verified";
  const executable = DIRECTIONS.has(candidate) && blockers.length === 0 && executionVenueConnected;
  return {
    layer: 3,
    name: "EXECUTION_APPROVAL",
    market: discovery?.market ?? "UNKNOWN",
    candidate,
    decision: executable ? candidate : paperApproved ? "PAPER SIGNAL APPROVED" : "REJECTED",
    paperApproved,
    executable,
    entry: plan?.entry ?? null,
    stopLoss: plan?.stopLoss ?? null,
    takeProfit: plan?.takeProfit ?? null,
    riskReward: plan?.riskReward ?? null,
    bid: quote?.bid ?? null,
    ask: quote?.ask ?? null,
    quoteSource: quote?.source ?? null,
    blockers
  };
}
