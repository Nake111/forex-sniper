import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { parseCandidateStrength, parseRiskReward, formatRiskReward } from "../src/signal-format.js";

const reportPath = process.argv[2];
if (!reportPath) throw new Error("Usage: node scripts/publish-signal-controller.js <signal-report.txt>");

const text = await readFile(reportPath, "utf8");
const now = Date.now();
const maxReportAgeMs = Number(process.env.MAX_SIGNAL_REPORT_AGE_MS ?? 10 * 60 * 1000);
const generatedMatch = text.match(/Generated UTC:\s*(.+)/);
const cycleUtcMatch = text.match(/Analysis cycle UTC:\s*(.+)/);
const cycleSloveniaMatch = text.match(/Analysis cycle Slovenia:\s*(.+)/);
const timezoneMatch = text.match(/Analysis timezone:\s*(.+)/);
const generatedAt = generatedMatch ? new Date(generatedMatch[1].trim().replace(" ", "T") + "Z") : null;
const analysisCycleAt = cycleUtcMatch ? new Date(cycleUtcMatch[1].trim()) : null;
const analysisCycleSlovenia = cycleSloveniaMatch?.[1]?.trim() ?? null;
if (!generatedAt || !Number.isFinite(generatedAt.getTime())) {
  throw new Error("Signal report has no valid Generated UTC timestamp");
}
if (!analysisCycleAt || !Number.isFinite(analysisCycleAt.getTime()) ||
    !analysisCycleSlovenia || timezoneMatch?.[1]?.trim() !== "Europe/Ljubljana") {
  throw new Error("Signal report is missing the shared Europe/Ljubljana analysis-cycle timestamp");
}
const reportAgeMs = now - generatedAt.getTime();
const analysisCycle = {
  id: analysisCycleAt.toISOString(),
  timestampUtc: analysisCycleAt.toISOString(),
  timestampSlovenia: analysisCycleSlovenia,
  timeZone: "Europe/Ljubljana"
};
if (reportAgeMs < -60_000 || reportAgeMs > maxReportAgeMs) {
  throw new Error(`Signal report is stale or future-dated: age=${reportAgeMs}ms`);
}

const markets = [
  { id: "EURUSD", header: "EUR/USD SNIPER AI" },
  { id: "BTCUSD", header: "BTC/USD SNIPER AI" },
  { id: "XAUUSD", header: "XAU/USD (Gold) SNIPER AI" }
];

function lineValue(section, label) {
  const line = section.split(/\r?\n/).find(item => item.trimStart().startsWith(label));
  return line ? line.slice(line.indexOf(label) + label.length).trim() : null;
}
function jsonLine(section, label) {
  const raw = lineValue(section, label);
  if (!raw) throw new Error(`Missing required report evidence: ${label}`);
  try { return JSON.parse(raw); }
  catch { throw new Error(`Invalid JSON report evidence: ${label}`); }
}
function numberAfter(section, label) {
  const raw = lineValue(section, label);
  if (raw === null) return null;
  const value = Number(raw.split(/\s+/)[0]);
  return Number.isFinite(value) ? value : null;
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date(now).toISOString(),
  generatedAtSlovenia: new Date(now).toLocaleString("sv-SE", { timeZone: "Europe/Ljubljana", hour12: false }),
  timeZone: "Europe/Ljubljana",
  analysisCycle,
  sourceReportGeneratedAt: generatedAt.toISOString(),
  sourceReportAgeSeconds: Math.round(reportAgeMs / 1000),
  refreshTarget: "5 minutes; GitHub Actions schedule can be delayed",
  mode: "PAPER_RESEARCH_ONLY",
  markets: {}
};

for (const market of markets) {
  const start = text.indexOf(market.header);
  if (start < 0) throw new Error(`${market.id}: analysis section missing`);
  const later = markets.map(item => text.indexOf(item.header, start + market.header.length))
    .filter(index => index > start).sort((a, b) => a - b)[0] ?? text.length;
  const section = text.slice(start, later);
  if (!section.includes(`FINAL ${market.id} SIGNAL`)) {
    throw new Error(`${market.id}: final decision section missing`);
  }

  const approval = jsonLine(section, "AGENT 2 — INDEPENDENT SIGNAL APPROVAL:");
  const verification = jsonLine(section, "AGENT 3 — INDEPENDENT LIVE ENTRY VERIFICATION:");
  const marketReview = jsonLine(section, "AGENT 1 — BID/ASK + BUYER/SELLER REVIEW:");
  const quote = jsonLine(section, "BID/ASK MARKET QUOTE:");
  const layer2 = jsonLine(section, "LAYER 2 — INDEPENDENT VERIFICATION:");
  const layer3 = jsonLine(section, "LAYER 3 — EXECUTION APPROVAL:");
  const action = lineValue(section, "FINAL ACTION:");
  const scoreRaw = lineValue(section, "CANDIDATE STRENGTH / EVIDENCE COVERAGE:") ??
    lineValue(section, "WEIGHTED SCORE / COVERAGE:");
  const candidateStrength = parseCandidateStrength(scoreRaw);
  const entry = numberAfter(section, "ENTRY:");
  const signalReferenceEntry = numberAfter(section, "SIGNAL REFERENCE ENTRY:");
  const stopLoss = numberAfter(section, "STOP LOSS:");
  const takeProfit = numberAfter(section, "TAKE PROFIT:");
  const riskRewardValue = parseRiskReward(lineValue(section, "RISK / REWARD VALUE:") ??
    lineValue(section, "RISK / REWARD:"));
  const riskReward = formatRiskReward(riskRewardValue);
  const entryReference = lineValue(section, "ENTRY REFERENCE:") ?? null;

  const quoteAgeMs = Number(verification.quoteAgeMs);
  const quoteValid = verification.quoteValidationValid === true &&
    Number.isFinite(quoteAgeMs) && quoteAgeMs >= 0 && quoteAgeMs <= 15000 &&
    quote.timestampQuality === "PROVIDER_TIMESTAMP" && Number.isFinite(Number(quote.timestamp)) &&
    Number(quote.bid) > 0 && Number(quote.ask) > Number(quote.bid);
  const effectiveRiskReward = Number.isFinite(verification.effectiveRiskReward)
    ? verification.effectiveRiskReward : riskRewardValue;
  const reportApproved = action === "BUY" || action === "SELL";
  const paperApproved = reportApproved && approval.approved === true &&
    verification.approved === true && layer2.status === "PASSED" &&
    layer3.paperApproved === true && quoteValid &&
    Number.isFinite(entry) && Number.isFinite(stopLoss) &&
    Number.isFinite(takeProfit) && Number.isFinite(effectiveRiskReward) &&
    effectiveRiskReward >= 2 && typeof entryReference === "string" &&
    entryReference.startsWith(action === "BUY" ? "ASK" : "BID");
  const candidate = lineValue(section, "DIRECTIONAL CANDIDATE:") ?? "UNKNOWN";
  const candidateIsDirectional = candidate === "BUY" || candidate === "SELL";
  const candidatePlanGeometryValid = candidateIsDirectional &&
    Number.isFinite(entry) && Number.isFinite(stopLoss) && Number.isFinite(takeProfit) &&
    (candidate === "BUY"
      ? stopLoss < entry && takeProfit > entry
      : stopLoss > entry && takeProfit < entry) &&
    Number.isFinite(riskRewardValue) && riskRewardValue > 0 && entryReference !== null;
  const entryTriggerConfirmed = lineValue(section, "M5 ENTRY TRIGGER CONFIRMED:") === "true";
  const candidatePlan = candidatePlanGeometryValid ? {
    status: paperApproved ? "PAPER_SIGNAL_APPROVED" :
      effectiveRiskReward !== null && effectiveRiskReward < 2 ? "INDICATIVE_LIVE_QUOTE_PLAN_BELOW_1_TO_2" :
      entryTriggerConfirmed ? "INDICATIVE_LIVE_QUOTE_PLAN_NOT_APPROVED" : "INDICATIVE_LIVE_QUOTE_PLAN_TRIGGER_NOT_CONFIRMED",
    entry, signalReferenceEntry, entryReference, stopLoss, takeProfit,
    riskReward, riskRewardValue, entryTriggerConfirmed,
    stopMethod: lineValue(section, "STOP METHOD:") ?? "UNSPECIFIED"
  } : null;

  output.markets[market.id] = {
    label: market.id === "XAUUSD" ? "XAU/USD (Gold)" : market.id === "EURUSD" ? "EUR/USD" : "BTC/USD",
    decision: paperApproved ? action : "NO APPROVED TRADE",
    status: paperApproved ? "PAPER_SIGNAL_APPROVED" : "REJECTED_OR_UNVERIFIED",
    candidate,
    candidateStatus: paperApproved ? "APPROVED_PAPER_SIGNAL" : candidatePlan ? "WATCHLIST_ONLY_NOT_APPROVED" : "NO_VALID_DIRECTIONAL_PLAN",
    candidatePlan,
    score: candidateStrength
      ? candidateStrength.score + "/" + candidateStrength.maxScore + " candidate strength · " +
        (candidateStrength.evidenceCoveragePct ?? "n/a") + "% evidence coverage"
      : scoreRaw ?? null,
    candidateStrength,
    paperApproval: { status: paperApproved ? "APPROVED" : "NOT_APPROVED", approved: paperApproved,
      decision: paperApproved ? action : "NO APPROVED TRADE" },
    brokerExecution: {
      status: layer3.brokerExecutionStatus ?? "NOT_CONNECTED_PAPER_ONLY",
      connected: layer3.brokerExecutionConnected === true, executable: false,
      blockers: (layer3.brokerBlockers ?? []).filter(value => typeof value === "string")
    },
    entry: paperApproved ? entry : null,
    stopLoss: paperApproved ? stopLoss : null,
    takeProfit: paperApproved ? takeProfit : null,
    riskReward: paperApproved ? riskReward : null,
    quote: {
      bid: Number(quote.bid) || null,
      ask: Number(quote.ask) || null,
      source: quote.source ?? "unknown",
      timestamp: quote.timestamp ?? null,
      timestampQuality: quote.timestampQuality ?? null,
      ageMs: Number.isFinite(quoteAgeMs) ? quoteAgeMs : null,
      validated: quoteValid
    },
    agents: {
      marketIntelligenceApproved: marketReview.approved === true,
      signalApprovalApproved: approval.approved === true,
      entryVerificationApproved: verification.approved === true
    },
    verification: {
      layer2: layer2.status ?? "UNKNOWN",
      layer3: layer3.decision ?? "UNKNOWN",
      blockers: [
        ...(layer2.blockers ?? []),
        ...(layer3.paperBlockers ?? layer3.blockers ?? []),
        ...(verification.blockers ?? [])
      ].filter((value, index, all) => typeof value === "string" &&
        !String(value).toLowerCase().includes("broker execution venue/account") && all.indexOf(value) === index)
    },
    generatedAt: new Date(now).toISOString(),
    generatedAtSlovenia: new Date(now).toLocaleString("sv-SE", { timeZone: "Europe/Ljubljana", hour12: false }),
    analysisCycle
  };
}

const expectedMarkets = ["EURUSD", "BTCUSD", "XAUUSD"];
for (const id of expectedMarkets) {
  if (!output.markets[id]) throw new Error("Missing market in synchronized publication: " + id);
  if (output.markets[id].analysisCycle?.id !== analysisCycle.id) {
    throw new Error(id + " analysis cycle does not match shared cycle");
  }
}
if (Object.keys(output.markets).length !== expectedMarkets.length) {
  throw new Error("Unexpected market set; refusing partial or mixed-cycle publication");
}

await mkdir("dashboard/data", { recursive: true });
const destination = "dashboard/data/signals.json";
const temporary = destination + ".tmp";
await writeFile(temporary, JSON.stringify(output, null, 2) + "\n");
await rename(temporary, destination);
console.log("LIVE SIGNAL CONTROLLER PUBLISHED:", destination);
for (const [market, signal] of Object.entries(output.markets)) {
  console.log(`${market}: ${signal.decision} | ${signal.status} | quote age ${signal.quote.ageMs ?? "unknown"}ms`);
}
