import { buildPhase2Intelligence } from "./phase2-intelligence.js";
import { measureDirectionalAccuracy } from "./signal-quality.js";

const finite = Number.isFinite;
const round = (value, digits = 4) => finite(value) ? Number(value.toFixed(digits)) : null;

function summarize(rows) {
  const resolved = rows.filter(row => ["WIN", "LOSS", "TIMEOUT"].includes(row.outcome));
  const wins = resolved.filter(row => row.outcome === "WIN").length;
  const losses = resolved.filter(row => row.outcome === "LOSS").length;
  const timeouts = resolved.filter(row => row.outcome === "TIMEOUT").length;
  const rRows = resolved.filter(row => finite(row.netEstimatedR)).sort((a, b) =>
    String(a.resolvedAt ?? a.createdAt ?? "").localeCompare(String(b.resolvedAt ?? b.createdAt ?? "")) ||
    String(a.signalId ?? "").localeCompare(String(b.signalId ?? ""))
  );
  const net = rRows.map(row => row.netEstimatedR);
  const gross = resolved.map(row => row.grossR).filter(finite);
  const avg = values => values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  const sum = values => values.length ? round(values.reduce((a, b) => a + b, 0)) : null;
  const positive = net.filter(value => value > 0).reduce((a, b) => a + b, 0);
  const negative = Math.abs(net.filter(value => value < 0).reduce((a, b) => a + b, 0));
  let equity = 0, peak = 0, maxDrawdown = 0;
  for (const value of net) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  const winRs = resolved.filter(row => finite(row.netEstimatedR) && row.netEstimatedR > 0).map(row => row.netEstimatedR);
  const lossRs = resolved.filter(row => finite(row.netEstimatedR) && row.netEstimatedR < 0).map(row => row.netEstimatedR);
  const decisive = wins + losses;
  return {
    signals: rows.length, resolved: resolved.length,
    pending: rows.filter(row => row.outcome === "PENDING").length,
    wins, losses, timeouts, ambiguous: rows.filter(row => row.outcome === "AMBIGUOUS").length,
    winRatePct: decisive ? round(wins / decisive * 100, 2) : null,
    winRateDenominator: "WIN + LOSS only; TIMEOUT and AMBIGUOUS excluded",
    averageGrossR: avg(gross), averageNetEstimatedR: avg(net),
    expectancyR: avg(net), totalNetEstimatedR: sum(net),
    averageWinR: avg(winRs), averageLossR: avg(lossRs),
    payoffRatio: avg(lossRs) !== null && avg(lossRs) !== 0 && avg(winRs) !== null
      ? round(avg(winRs) / Math.abs(avg(lossRs)), 3) : null,
    profitFactor: negative > 0 ? round(positive / negative, 3) : positive > 0 ? null : 0,
    maxDrawdownR: round(maxDrawdown),
    rCoverage: { resolvedWithNetR: rRows.length, resolvedWithoutNetR: resolved.length - rRows.length },
    costCoverage: {
      withEstimatedCommission: resolved.filter(row => row.commissionIncluded).length,
      withoutEstimatedCommission: resolved.filter(row => !row.commissionIncluded).length
    },
    sampleWarning: resolved.length < 30 ? "Small sample: do not rank this strategy as proven." : null
  };
}

export function buildPaperPerformance(events, generatedAt = new Date().toISOString()) {
  if (!Array.isArray(events)) throw new Error("Paper journal events must be an array");
  const signals = events.filter(event => event.eventType === "PAPER_SIGNAL");
  const outcomes = new Map(events.filter(event => event.eventType === "PAPER_OUTCOME").map(event => [event.signalId, event]));
  const records = signals.map(signal => {
    const outcome = outcomes.get(signal.signalId);
    return {
      ...signal, ...(outcome ?? { outcome: "PENDING" }),
      netEstimatedR: finite(outcome?.netEstimatedR) ? outcome.netEstimatedR
        : finite(outcome?.netEstimatedRExcludingCommission) ? outcome.netEstimatedRExcludingCommission : null,
      commissionIncluded: finite(outcome?.estimatedCommissionCostR)
    };
  });
  const groupBy = keyFn => {
    const groups = new Map();
    for (const row of records) {
      const key = String(keyFn(row) ?? "UNKNOWN");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return Object.fromEntries([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, rows]) => [key, summarize(rows)]));
  };
  return {
    schemaVersion: 2, generatedAt, mode: "PAPER_RESEARCH_ONLY",
    methodology: "Only approved paper signals are included. Outcomes use subsequent closed M5 candle OHLC: first stop/target touch, ambiguous if both touch in one candle, or timeout after 180 bars at candle close. Net estimated R subtracts observed signal-time spread plus configured estimated slippage; commission is subtracted only when configured. When commission is not configured, the report falls back to net R excluding commission and flags that coverage. No broker fills are assumed. Drawdown is peak-to-trough cumulative resolved net estimated R, not account-currency or equity drawdown.",
    totals: summarize(records),
    byStrategy: groupBy(row => row.strategy?.strategyId ?? "LEGACY_UNATTRIBUTED"),
    byMarket: groupBy(row => row.market),
    bySide: {
      BUY: summarize(records.filter(row => row.side === "BUY")),
      SELL: summarize(records.filter(row => row.side === "SELL"))
    },
    bySession: groupBy(row => row.strategy?.session ?? "UNKNOWN"),
    byProfile: groupBy(row => row.strategy?.profile ?? "UNKNOWN"),
    phase2Intelligence: buildPhase2Intelligence(events, generatedAt),
    agentAccountability: Object.fromEntries([...new Set(events.filter(event => event.eventType === "AGENT_FORECAST_OUTCOME").map(event => event.agent))].sort().map(agent => {
      const rows = events.filter(event => event.eventType === "AGENT_FORECAST_OUTCOME" && event.agent === agent);
      return [agent, measureDirectionalAccuracy(rows)];
    })),
    records: records.map(row => ({
      signalId: row.signalId, market: row.market, side: row.side,
      createdAt: row.createdAt, strategy: row.strategy ?? { strategyId: "LEGACY_UNATTRIBUTED" },
      outcome: row.outcome, resolvedAt: row.resolvedAt ?? null,
      grossR: row.grossR ?? null, netEstimatedR: row.netEstimatedR ?? null,
      commissionIncluded: row.commissionIncluded
    }))
  };
}
