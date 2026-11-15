const VALID_OUTCOMES = new Set(["WIN", "LOSS", "TIMEOUT"]);
const finite = Number.isFinite;

function timestamp(value) {
  const parsed = typeof value === "number"
    ? (value < 1e12 ? value * 1000 : value)
    : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function summarize(trades) {
  const values = trades.map(row => row.netR);
  const wins = values.filter(value => value > 0);
  const losses = values.filter(value => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  let equity = 0;
  let peak = 0;
  let maxDrawdownR = 0;
  for (const value of values) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
  }
  return {
    sampleSize: values.length,
    wins: wins.length,
    losses: losses.length,
    timeouts: trades.filter(row => row.outcome === "TIMEOUT").length,
    winRatePct: values.length ? Number((wins.length / values.length * 100).toFixed(2)) : null,
    expectancyR: values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4)) : null,
    profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(3)) : grossProfit > 0 ? null : 0,
    maxDrawdownR: Number(maxDrawdownR.toFixed(3)),
    totalNetR: Number(values.reduce((sum, value) => sum + value, 0).toFixed(3))
  };
}

/**
 * Forward-paper out-of-sample gate.
 * Only PAPER_SIGNAL records created after the frozen training cutoff and their
 * resolved PAPER_OUTCOME records are eligible. Historical final-30% candles are
 * never read here. Missing cutoff/evidence fails closed.
 */
export function evaluateOutOfSamplePaperGate({
  events = [], market, trainingCutoff, now = Date.now(),
  minTrades = 30, minExpectancyR = 0, minProfitFactor = 1.1, maxDrawdownR = 8
} = {}) {
  const cutoff = timestamp(trainingCutoff);
  const fail = (reason, metrics = null) => ({
    approved: false, status: "BLOCKED", scope: "FORWARD_PAPER_ONLY",
    market: market ?? null, trainingCutoff: cutoff === null ? null : new Date(cutoff).toISOString(),
    holdoutRead: false, blockers: [reason], metrics
  });
  if (!Array.isArray(events)) return fail("Paper journal is unavailable or invalid");
  if (cutoff === null) return fail("Frozen AGENT_TRAINING_CUTOFF is missing; out-of-sample boundary is not established");
  if (!Number.isFinite(now) || now <= cutoff) return fail("No forward-paper period exists after the frozen training cutoff");

  const signals = new Map();
  for (const event of events) {
    if (event?.eventType !== "PAPER_SIGNAL" || event.market !== market || !event.signalId) continue;
    const createdAt = timestamp(event.createdAt);
    if (createdAt !== null && createdAt > cutoff && createdAt <= now) {
      signals.set(event.signalId, { ...event, _createdAt: createdAt });
    }
  }
  const trades = [];
  for (const event of events) {
    if (event?.eventType !== "PAPER_OUTCOME" || !signals.has(event.signalId)) continue;
    const resolvedAt = timestamp(event.resolvedAt ?? event.createdAt);
    const netR = finite(event.netEstimatedR) ? event.netEstimatedR
      : finite(event.netEstimatedRExcludingCommission) ? event.netEstimatedRExcludingCommission
      : finite(event.netR) ? event.netR : null;
    if (!VALID_OUTCOMES.has(event.outcome) || resolvedAt === null || resolvedAt > now || netR === null) continue;
    trades.push({
      signalId: event.signalId,
      createdAt: signals.get(event.signalId)._createdAt,
      resolvedAt,
      outcome: event.outcome,
      netR
    });
  }
  trades.sort((a, b) => a.resolvedAt - b.resolvedAt || a.createdAt - b.createdAt);
  const metrics = summarize(trades);
  const blockers = [];
  if (metrics.sampleSize < minTrades) blockers.push(`Insufficient forward-paper sample: ${metrics.sampleSize}/${minTrades} resolved trades`);
  if (metrics.expectancyR === null || metrics.expectancyR <= minExpectancyR) blockers.push("Forward-paper net expectancy is not positive");
  if (metrics.profitFactor === null || metrics.profitFactor < minProfitFactor) blockers.push(`Forward-paper profit factor is below ${minProfitFactor}`);
  if (metrics.maxDrawdownR > maxDrawdownR) blockers.push(`Forward-paper drawdown exceeds ${maxDrawdownR}R`);
  return {
    approved: blockers.length === 0,
    status: blockers.length ? "BLOCKED" : "APPROVED",
    scope: "FORWARD_PAPER_ONLY",
    market,
    trainingCutoff: new Date(cutoff).toISOString(),
    holdoutRead: false,
    metrics,
    thresholds: { minTrades, minExpectancyR, minProfitFactor, maxDrawdownR },
    blockers
  };
}
