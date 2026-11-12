/**
 * Unified deterministic decision brain.
 *
 * Combines the existing specialist modules into one auditable final decision.
 * Scores are evidence points, never probabilities. The brain cannot place orders.
 */
const DIRECTIONS = new Set(["BUY", "SELL"]);

export function decideBrainAction({
  market,
  candidate,
  weightedScore,
  verificationLayer,
  approval,
  entryVerification,
  executionLayer,
  hardBlockers = [],
  calendarBlocked = false,
  macroBlocked = false,
  dataStale = false,
  newsBlocked = false
}) {
  const direction = DIRECTIONS.has(candidate) ? candidate : "NO SETUP";
  const blockers = [...new Set([
    ...hardBlockers,
    ...(verificationLayer?.blockers ?? []),
    ...(approval?.blockers ?? []),
    ...(entryVerification?.blockers ?? []),
    ...(calendarBlocked ? ["ECONOMIC_CALENDAR_BLOCK"] : []),
    ...(macroBlocked ? ["MACRO_RISK_BLOCK"] : []),
    ...(dataStale ? ["STALE_OR_INCOMPLETE_MARKET_DATA"] : []),
    ...(newsBlocked ? ["HIGH_IMPACT_NEWS_WINDOW"] : [])
  ].filter(Boolean).map(String))];

  const checks = {
    directionalCandidate: direction !== "NO SETUP",
    weightedEvidenceEligible: weightedScore?.status === "ELIGIBLE_FOR_RISK_GATE",
    independentVerificationPassed: verificationLayer?.status === "PASSED",
    signalApprovalPassed: approval?.approved === true && approval?.decision === direction,
    entryVerificationPassed: entryVerification?.approved === true && entryVerification?.decision === direction,
    paperExecutionApproved: executionLayer?.paperApproved === true,
    calendarClear: !calendarBlocked,
    macroClear: !macroBlocked,
    dataFresh: !dataStale,
    newsClear: !newsBlocked,
    noHardBlockers: blockers.length === 0
  };

  const approved = Object.values(checks).every(Boolean);
  const action = approved ? direction : "NO TRADE";
  return {
    market,
    action,
    candidate: direction,
    approved,
    mode: "PAPER_RESEARCH_ONLY",
    score: Number.isFinite(weightedScore?.score) ? weightedScore.score : null,
    scoreMeaning: "HEURISTIC_EVIDENCE_POINTS_NOT_PROBABILITY",
    checks,
    blockers: approved ? [] : blockers.length ? blockers : ["ONE_OR_MORE_REQUIRED_DECISION_CHECKS_FAILED"],
    explanation: approved
      ? `${direction} passed every deterministic, independent and paper-risk check for ${market}.`
      : direction === "NO SETUP"
        ? `No directional setup was identified for ${market}.`
        : `${direction} was evaluated but not approved for ${market}; at least one required check failed.`,
    brokerExecutionEnabled: false
  };
}
