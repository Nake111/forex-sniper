import { measureDirectionalAccuracy } from "./signal-quality.js";

const finite = Number.isFinite;
const round = (value, digits = 4) => finite(value) ? Number(value.toFixed(digits)) : null;

function summarize(rows) {
  const resolved = rows.filter(row => ["WIN", "LOSS", "TIMEOUT"].includes(row.outcome));
  const wins = resolved.filter(row => row.outcome === "WIN").length;
  const losses = resolved.filter(row => row.outcome === "LOSS").length;
  const timeouts = resolved.filter(row => row.outcome === "TIMEOUT").length;
  const rValues = resolved.map(row => row.netEstimatedR).filter(finite);
  const grossValues = resolved.map(row => row.grossR).filter(finite);
  const avg = values => values.length ? round(values.reduce((a,b)=>a+b,0)/values.length) : null;
  const sum = values => values.length ? round(values.reduce((a,b)=>a+b,0)) : null;
  const grossWins = resolved.filter(row => finite(row.netEstimatedR) && row.netEstimatedR > 0).reduce((s,row)=>s+row.netEstimatedR,0);
  const grossLosses = Math.abs(resolved.filter(row => finite(row.netEstimatedR) && row.netEstimatedR < 0).reduce((s,row)=>s+row.netEstimatedR,0));
  return {
    signals: rows.length, resolved: resolved.length, pending: rows.length - rows.filter(row => row.outcome !== "PENDING").length,
    wins, losses, timeouts, ambiguous: rows.filter(row => row.outcome === "AMBIGUOUS").length,
    winRatePct: resolved.length ? round(wins / resolved.length * 100, 2) : null,
    averageGrossR: avg(grossValues), averageNetEstimatedR: avg(rValues), totalNetEstimatedR: sum(rValues),
    profitFactor: grossLosses > 0 ? round(grossWins / grossLosses, 3) : grossWins > 0 ? null : 0,
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
      // Use all known execution costs even when commission is not configured.
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
    return Object.fromEntries([...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([key,rows])=>[key,summarize(rows)]));
  };
  return {
    schemaVersion: 1, generatedAt, mode: "PAPER_RESEARCH_ONLY",
    methodology: "Only approved paper signals are included. Outcomes use subsequent closed M5 candle OHLC: first stop/target touch, ambiguous if both touch in one candle, or timeout after 180 bars at candle close. Net R subtracts observed signal-time spread plus configured estimated slippage; commission is subtracted only when configured, otherwise reported net R excludes commission. No broker fills are assumed.",
    totals: summarize(records),
    byStrategy: groupBy(row => row.strategy?.strategyId ?? "LEGACY_UNATTRIBUTED"),
    byMarket: groupBy(row => row.market),
    bySide: {
      BUY: summarize(records.filter(row => row.side === "BUY")),
      SELL: summarize(records.filter(row => row.side === "SELL"))
    },
    bySession: groupBy(row => row.strategy?.session ?? "UNKNOWN"),
    byProfile: groupBy(row => row.strategy?.profile ?? "UNKNOWN"),
    agentAccountability: Object.fromEntries([...new Set(events.filter(event => event.eventType === "AGENT_FORECAST_OUTCOME").map(event => event.agent))].sort().map(agent => {
      const rows = events.filter(event => event.eventType === "AGENT_FORECAST_OUTCOME" && event.agent === agent);
      return [agent, measureDirectionalAccuracy(rows)];
    })),
    records: records.map(row => ({
      signalId: row.signalId, market: row.market, side: row.side,
      createdAt: row.createdAt, strategy: row.strategy ?? { strategyId: "LEGACY_UNATTRIBUTED" },
      outcome: row.outcome, resolvedAt: row.resolvedAt ?? null,
      grossR: row.grossR ?? null, netEstimatedR: row.netEstimatedR ?? null
    }))
  };
}
