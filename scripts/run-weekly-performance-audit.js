import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { buildPaperPerformance } from "../src/paper-performance.js";
import { measureDirectionalAccuracy } from "../src/signal-quality.js";

const journalPath = process.env.PAPER_JOURNAL_PATH ?? "data/second-brain.jsonl";
const now = new Date();
const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
let events = [];
try {
  const raw = await readFile(journalPath, "utf8");
  events = raw.split("\n").filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error("Invalid paper journal JSON at line " + (index + 1) + "; audit aborted to protect evidence integrity"); }
  });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const timeOf = event => {
  const value = event.resolvedAt ?? event.observedAt ?? event.forecastAt ?? event.createdAt;
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) ? (parsed < 1e12 ? parsed * 1000 : parsed) : null;
};
const recent = events.filter(event => {
  const time = timeOf(event);
  return time !== null && time >= periodStart.getTime() && time <= now.getTime();
});
const outcomes = events.filter(event => event.eventType === "AGENT_FORECAST_OUTCOME");
const recentOutcomes = recent.filter(event => event.eventType === "AGENT_FORECAST_OUTCOME");
const agents = [...new Set(outcomes.map(event => event.agent))].sort();
const agentMetrics = rows => Object.fromEntries(agents.map(agent => [
  agent, measureDirectionalAccuracy(rows.filter(event => event.agent === agent))
]));
const byRegime = rows => Object.fromEntries([...new Set(rows.map(event => event.forecastRegime ?? "UNKNOWN"))].sort().map(regime => {
  const group = rows.filter(event => (event.forecastRegime ?? "UNKNOWN") === regime);
  return [regime, { forecasts: group.length, agents: agentMetrics(group) }];
}));
const observations = recent.filter(event => event.eventType === "PAPER_OBSERVATION" && event.quoteEvidence);
const ages = observations.map(event => event.quoteEvidence.quoteAgeMs).filter(Number.isFinite);
const spreads = observations.map(event => event.quoteEvidence.observedSpreadBps).filter(Number.isFinite);
const quoteQuality = {
  observations: observations.length,
  validQuotes: observations.filter(event => event.quoteEvidence.validation === "VALID").length,
  quoteAgeMsAverage: ages.length ? Number((ages.reduce((a,b)=>a+b,0)/ages.length).toFixed(1)) : null,
  quoteAgeMsMax: ages.length ? Math.max(...ages) : null,
  observedSpreadBpsAverage: spreads.length ? Number((spreads.reduce((a,b)=>a+b,0)/spreads.length).toFixed(4)) : null,
  actualFillsRecorded: recent.filter(event => event.eventType === "PAPER_SIGNAL" && event.actualFillPrice !== null && event.actualFillPrice !== undefined).length,
  note: "Paper estimates are not actual fills. Observed slippage is only measurable when a real fill price and timestamp are recorded."
};
const allTimePerformance = buildPaperPerformance(events, now.toISOString());
const recentSignalIds = new Set(events.filter(event => event.eventType === "PAPER_SIGNAL").filter(event => {
  const t = timeOf(event);
  return t !== null && t >= periodStart.getTime() && t <= now.getTime();
}).map(event => event.signalId));
for (const outcome of events.filter(event => event.eventType === "PAPER_OUTCOME")) {
  const t = timeOf(outcome);
  if (t !== null && t >= periodStart.getTime() && t <= now.getTime()) recentSignalIds.add(outcome.signalId);
}
const weeklyPaperEvents = events.filter(event =>
  (event.eventType === "PAPER_SIGNAL" && recentSignalIds.has(event.signalId)) ||
  (event.eventType === "PAPER_OUTCOME" && recentSignalIds.has(event.signalId))
);
const weeklyPaperPerformance = buildPaperPerformance(weeklyPaperEvents, now.toISOString());

const audit = {
  schemaVersion: 1,
  generatedAt: now.toISOString(),
  window: { start: periodStart.toISOString(), end: now.toISOString(), days: 7 },
  mode: "PAPER_RESEARCH_ONLY",
  validationPolicy: {
    holdoutAccessed: false,
    holdoutUsedForTuning: false,
    tuningAllowedOnlyOnChronologicalFirst70Percent: true,
    final30Percent: "Reserved untouched; evaluate once only after candidate settings are frozen.",
    consensusThresholdChanged: false,
    brokerOrdersPlaced: false
  },
  dataCoverage: {
    journalEventsTotal: events.length,
    eventsInLast7Days: recent.length,
    agentForecastOutcomesAllTime: outcomes.length,
    agentForecastOutcomesLast7Days: recentOutcomes.length
  },
  directionalAccuracy: {
    allTimeByAgent: agentMetrics(outcomes),
    last7DaysByAgent: agentMetrics(recentOutcomes),
    last7DaysByRegime: byRegime(recentOutcomes)
  },
  executionEvidenceLast7Days: quoteQuality,
  paperPerformance: {
    allTime: allTimePerformance,
    last7Days: weeklyPaperPerformance
  }
};

await mkdir("dashboard/data", { recursive: true });
await mkdir("reports", { recursive: true });
const jsonPath = "dashboard/data/weekly-performance-audit.json";
const mdPath = "reports/weekly-performance-audit.md";
const md = [
  "# Forex Sniper — Weekly Performance Audit",
  "",
  "- Generated: " + now.toISOString(),
  "- Window: " + periodStart.toISOString() + " to " + now.toISOString(),
  "- Mode: PAPER / RESEARCH ONLY",
  "",
  "## Independent agent accuracy",
  "",
  "| Agent | BUY predictions | BUY accuracy | BUY false signals | SELL predictions | SELL accuracy | SELL false signals |",
  "|---|---:|---:|---:|---:|---:|---:|",
  ...agents.map(agent => {
    const m = audit.directionalAccuracy.last7DaysByAgent[agent];
    return "| " + agent + " | " + m.BUY.predictions + " | " + (m.BUY.accuracyPct ?? "n/a") + " | " + m.BUY.falseSignals + " | " + m.SELL.predictions + " | " + (m.SELL.accuracyPct ?? "n/a") + " | " + m.SELL.falseSignals + " |";
  }),
  "",
  "## Market regimes",
  "",
  ...Object.entries(audit.directionalAccuracy.last7DaysByRegime).map(([regime, value]) => "- **" + regime + ":** " + value.forecasts + " resolved forecasts"),
  "",
  "## Execution evidence",
  "",
  "- Quote observations: " + quoteQuality.observations,
  "- Valid quotes: " + quoteQuality.validQuotes,
  "- Average quote age: " + (quoteQuality.quoteAgeMsAverage ?? "n/a") + " ms",
  "- Maximum quote age: " + (quoteQuality.quoteAgeMsMax ?? "n/a") + " ms",
  "- Average observed spread: " + (quoteQuality.observedSpreadBpsAverage ?? "n/a") + " bps",
  "- Actual fills recorded: " + quoteQuality.actualFillsRecorded,
  "- Slippage is not inferred from estimates; no actual fill means no observed slippage.",
  "",
  "## Validation safeguards",
  "",
  "- Holdout accessed: **No**",
  "- Holdout used for tuning: **No**",
  "- First 70% remains the only tuning segment.",
  "- Final 30% remains reserved for one untouched evaluation after settings are frozen.",
  "- 3/5 consensus threshold unchanged.",
  "- No broker orders placed.",
  "",
  "## Sample-size warning",
  "",
  "Accuracy percentages are descriptive, not proof of profitability. Do not rank agents or change strategy settings on small samples; require adequate resolved samples and training-only validation.",
  ""
].join("\n");
await writeFile(jsonPath + ".tmp", JSON.stringify(audit, null, 2) + "\n");
await rename(jsonPath + ".tmp", jsonPath);
await writeFile(mdPath, md);
console.log("WEEKLY PAPER AUDIT GENERATED:", mdPath);
console.log("Forecast outcomes:", outcomes.length, "| last 7 days:", recentOutcomes.length);
console.log("Quote observations last 7 days:", quoteQuality.observations);
