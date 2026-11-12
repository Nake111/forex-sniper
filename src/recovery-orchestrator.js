/**
 * Bounded recovery policy for failed signal validation.
 * Recovery may refresh evidence, but can never waive a hard risk/data blocker.
 * External trader ideas are advisory corroboration only.
 */
const RETRYABLE = [
  /timeout/i, /temporar(?:y|ily)/i, /rate.?limit/i, /provider.*unavailable/i,
  /quote.*stale/i, /stale.*quote/i, /missing.*candle/i, /incomplete.*candle/i,
  /feed.*unavailable/i, /network/i
];
const HARD_BLOCK = [
  /risk.?reward/i, /stop.?loss/i, /position.?risk/i, /spread.*exceed/i,
  /high.?impact.*news/i, /economic.?calendar.*block/i, /timeframe.*conflict/i,
  /direction.*conflict/i, /invalid.*price/i, /invalid.*ohlc/i,
  /market.*closed/i, /hard.?risk/i
];

export function classifyRecoveryBlockers(blockers = []) {
  const unique = [...new Set((Array.isArray(blockers) ? blockers : []).filter(Boolean).map(String))];
  const hard = [];
  const retryable = [];
  const unresolved = [];
  for (const blocker of unique) {
    if (HARD_BLOCK.some(pattern => pattern.test(blocker))) hard.push(blocker);
    else if (RETRYABLE.some(pattern => pattern.test(blocker))) retryable.push(blocker);
    else unresolved.push(blocker);
  }
  return { hard, retryable, unresolved };
}

/**
 * Produces a bounded recovery plan. Callers may perform at most two refresh
 * attempts; every attempt must revalidate provider timestamps and recompute
 * indicators. This function does not approve a trade or manufacture prices.
 */
export function buildRecoveryPlan({ blockers = [], attempt = 0, maxAttempts = 2, traderEvidence = [] } = {}) {
  const classified = classifyRecoveryBlockers(blockers);
  const boundedMax = Math.max(0, Math.min(2, Number.isInteger(maxAttempts) ? maxAttempts : 2));
  const validAttempt = Number.isInteger(attempt) && attempt >= 0 ? attempt : 0;
  const consensus = (Array.isArray(traderEvidence) ? traderEvidence : [])
    .filter(item => item && item.verified === true && item.timestamp && item.symbol && item.direction)
    .map(item => ({
      source: String(item.source ?? "unattributed").slice(0, 120),
      symbol: String(item.symbol).toUpperCase(),
      direction: ["BUY", "SELL"].includes(String(item.direction).toUpperCase())
        ? String(item.direction).toUpperCase() : "UNUSABLE",
      timestamp: String(item.timestamp),
      timeframe: String(item.timeframe ?? "UNKNOWN"),
      entry: Number.isFinite(Number(item.entry)) ? Number(item.entry) : null,
      stopLoss: Number.isFinite(Number(item.stopLoss)) ? Number(item.stopLoss) : null,
      takeProfit: Number.isFinite(Number(item.takeProfit)) ? Number(item.takeProfit) : null
    }))
    .filter(item => item.direction !== "UNUSABLE");

  const canRetry = classified.hard.length === 0 &&
    classified.retryable.length > 0 && validAttempt < boundedMax;
  return {
    status: classified.hard.length ? "HARD_BLOCKED"
      : canRetry ? "RECHECK_RECOMMENDED"
        : classified.retryable.length ? "RETRY_LIMIT_REACHED"
          : classified.unresolved.length ? "UNRESOLVED_BLOCKERS"
            : "NO_RECOVERY_NEEDED",
    attempt: validAttempt,
    maxAttempts: boundedMax,
    canRetry,
    retrySteps: canRetry
      ? ["REFRESH_PRIMARY_AND_BACKUP_QUOTES_AND_CANDLES",
         "VERIFY_PROVIDER_TIMESTAMPS_SPREAD_AND_CANDLE_COMPLETENESS",
         "RECOMPUTE_INDICATORS_AND_ALL_TIMEFRAMES",
         "RECHECK_CALENDAR_NEWS_AND_MARKET_RISK",
         "REBUILD_ENTRY_STOP_TARGET_AND_RISK_REWARD"]
      : [],
    hardBlockers: classified.hard,
    retryableBlockers: classified.retryable,
    unresolvedBlockers: classified.unresolved,
    externalTraderEvidence: {
      status: consensus.length ? "ADVISORY_EVIDENCE_AVAILABLE" : "UNAVAILABLE_OR_UNVERIFIED",
      verifiedIdeas: consensus,
      mayOverrideValidation: false
    },
    approvalGranted: false,
    note: "Recovery never approves a trade. All original approval, entry and risk gates must pass again."
  };
}
