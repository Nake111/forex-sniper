/**
 * Eight-role Quant Desk inspired by the supplied reference.
 * Research-only diagnostics: zero signal weight and no approval authority.
 * The Chief coordinates specialist outputs but cannot bypass core risk gates.
 */
const directional = value => value === "BUY" || value === "SELL";

function role(name, status, detail, evidence = {}) {
  return { name, status, detail, evidence };
}

export function runEightAgentQuantDesk({
  market, candidate, weightedScore, frames = {}, quoteValidation = {},
  spreadVerified = false, staleTimeframes = [], macroBlocked = false,
  macro = {}, marketReview = {}, plan = null, candles = []
}) {
  const m5 = frames.M5 ?? {};
  const direction = directional(candidate) ? candidate : "NO_SETUP";
  const score = Number.isFinite(weightedScore?.score) ? weightedScore.score : null;
  const scout = role("SCOUT",
    direction !== "NO_SETUP" ? "SHORTLISTED" : "NO_SETUP",
    direction !== "NO_SETUP" ? "Found a directional candidate for review." : "No directional candidate found.",
    { market, direction, score, scoreCoverage: weightedScore?.coverage ?? null });

  const auditChecks = {
    quoteValid: quoteValidation.valid === true,
    spreadVerified: spreadVerified === true,
    candlesFresh: staleTimeframes.length === 0,
    macroClear: macroBlocked === false
  };
  const auditPassed = Object.values(auditChecks).every(Boolean);
  const auditor = role("AUDITOR", auditPassed ? "CHECKS_PASSED" : "BLOCKED",
    auditPassed ? "Research data and risk pre-checks passed; this is not trade approval." : "One or more pre-checks failed.",
    auditChecks);

  const triggerConfirmed = plan?.entryTriggerConfirmed === true;
  const trigger = role("TRIGGER",
    direction === "NO_SETUP" ? "WAITING_FOR_CANDIDATE" : triggerConfirmed ? "TRIGGER_CONFIRMED" : "WAITING_FOR_M5",
    triggerConfirmed ? "The existing M5 trigger flag is confirmed." : "No confirmed M5 entry trigger; no entry is suggested.",
    { entryTriggerConfirmed: triggerConfirmed });

  const flow = marketReview.orderFlow ?? m5.orderFlow ?? null;
  const tracker = role("TRACKER",
    flow ? "PROXY_EVIDENCE_AVAILABLE" : "NO_VERIFIED_FLOW_FEED",
    flow ? "Buyer/seller evidence is treated as a proxy, not full order-book or institutional flow." :
      "No verified market-wide positioning or order-book depth supplied to this role.",
    { evidence: flow, limitations: "Spot FX has no consolidated exchange tape; do not invent smart-wallet data." });

  const warden = role("WARDEN",
    macroBlocked || staleTimeframes.length || !spreadVerified ? "RISK_WARNING" : "NO_PRECHECK_WARNING",
    "Monitors spread, data freshness and macro/news risk. Core gates remain authoritative.",
    { macroBlocked, staleTimeframes, spreadVerified, spread: quoteValidation.spread ?? null });

  const trail = role("TRAIL",
    plan ? "PAPER_PLAN_MONITOR_ONLY" : "NO_PLAN",
    "Tracks the existing paper plan for later review; does not move stops or manage live positions.",
    { entry: plan?.entry ?? null, stopLoss: plan?.stopLoss ?? null, takeProfit: plan?.takeProfit ?? null,
      stopManagement: "NO_AUTOMATIC_MODIFICATION" });

  const headlines = Array.isArray(macro.headlines) ? macro.headlines : [];
  const pulse = role("PULSE",
    headlines.length ? "HEADLINES_PRESENT" : "SENTIMENT_UNVERIFIED",
    "Measures available headline context only; no social-mention velocity feed is assumed.",
    { headlineCount: headlines.length, eventRisk: macro.eventRisk ?? "UNKNOWN",
      sentiment: "NOT_COMPUTED", mentionVelocity: null });

  const roles = [scout, auditor, trigger, tracker, warden, trail, pulse];
  const chief = {
    name: "CHIEF",
    status: "RESEARCH_COORDINATED",
    detail: "Seven specialist roles reviewed the same market snapshot. Chief has zero voting weight and cannot approve a trade.",
    researchDirection: direction,
    specialistCount: roles.length,
    blockedRoles: roles.filter(item => ["BLOCKED", "RISK_WARNING", "WAITING_FOR_M5", "NO_VERIFIED_FLOW_FEED"].includes(item.status)).map(item => item.name),
    approvalAuthority: false,
    signalWeight: 0,
    finalTradeDecision: "DEFER_TO_EXISTING_FOREX_SNIPER_APPROVAL_CHAIN"
  };

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    market,
    mode: "PAPER_RESEARCH_ONLY",
    roles,
    chief,
    userHandoff: "Review the research desk; manually decide whether to act on an independently approved paper signal.",
    safety: { signalWeight: 0, canApproveTrade: false, canPlaceOrders: false }
  };
}
