import { readFile } from "node:fs/promises";

const file = process.argv[2] ?? "market-snapshot.txt";
const maxQuoteAgeMs = Number(process.env.MAX_SNAPSHOT_QUOTE_AGE_MS ?? 15000);
const log = await readFile(file, "utf8");
const markets = ["EURUSD", "BTCUSD", "XAUUSD"];
const headers = {
  EURUSD: "EUR/USD SNIPER AI",
  BTCUSD: "BTC/USD SNIPER AI",
  XAUUSD: "XAU/USD (Gold) SNIPER AI"
};
const labels = [
  ["AGENT 1 — BID/ASK + BUYER/SELLER REVIEW:", "market intelligence"],
  ["AGENT 2 — INDEPENDENT SIGNAL APPROVAL:", "signal approval"],
  ["AGENT 3 — INDEPENDENT LIVE ENTRY VERIFICATION:", "entry verification"]
];
const expectedResearchAgents = [
  "hpFX multi-timeframe",
  "ICT/SMC structure",
  "FxTT market scanner",
  "Gann/Hurst trend",
  "Systematic breakout"
];
const researchMarkers = [
  "FIVE INDEPENDENT SIGNAL AGENTS:",
  "FIVE-AGENT CONSENSUS:",
  "FIVE-AGENT VALIDATION FRAMEWORK:"
];
const lines = log.split(/\r?\n/);
const exactLineIndex = value => lines.findIndex(line => line.trim() === value);

for (const market of markets) {
  const start = exactLineIndex(headers[market]);
  if (start < 0) throw new Error(`${market}: market analysis heading missing`);
  const nextStarts = markets.map(name => exactLineIndex(headers[name]))
    .filter(index => index > start).sort((a, b) => a - b);
  const end = nextStarts[0] ?? lines.length;
  const sectionLines = lines.slice(start, end);
  const finalIndex = sectionLines.findIndex(line => line.trim() === `FINAL ${market} SIGNAL`);
  if (finalIndex < 0) throw new Error(`${market}: final signal section missing from its exact market block`);
  const finalActionLine = sectionLines.slice(finalIndex).find(line => line.startsWith("FINAL ACTION:"));
  if (!finalActionLine) throw new Error(`${market}: final action line missing`);
  const action = finalActionLine.slice("FINAL ACTION:".length).trim();
  if (!["BUY", "SELL", "NO TRADE", "HOLD"].includes(action)) {
    throw new Error(`${market}: unrecognized final action ${action}`);
  }

  const researchReports = {};
  for (const marker of researchMarkers) {
    const matches = sectionLines.filter(value => value.includes(marker));
    if (matches.length !== 1) {
      throw new Error(`${market}: expected exactly one ${marker} report; found ${matches.length}`);
    }
    const raw = matches[0].slice(matches[0].indexOf(marker) + marker.length).trim();
    try { researchReports[marker] = JSON.parse(raw); }
    catch { throw new Error(`${market}: invalid JSON in ${marker}`); }
  }

  const agents = researchReports["FIVE INDEPENDENT SIGNAL AGENTS:"];
  const names = Array.isArray(agents) ? agents.map(agent => agent?.name) : [];
  if (names.length !== 5 || new Set(names).size !== 5 ||
      expectedResearchAgents.some(name => !names.includes(name)) ||
      agents.some(agent => !["BUY", "SELL", "NO_SIGNAL"].includes(agent?.signal) ||
        agent.direction !== agent.signal || typeof agent.reason !== "string" || !agent.reason.trim())) {
    throw new Error(`${market}: five distinct research agents did not all execute with valid outputs`);
  }

  const consensus = researchReports["FIVE-AGENT CONSENSUS:"];
  if (consensus?.totalAgents !== 5 || consensus?.requiredVotes !== 3 ||
      typeof consensus.approved !== "boolean" ||
      !["BUY", "SELL", "NO_SIGNAL"].includes(consensus.direction) ||
      !consensus.counts || consensus.counts.BUY + consensus.counts.SELL + consensus.counts.NO_SIGNAL !== 5 ||
      (consensus.approved && !["BUY", "SELL"].includes(consensus.direction)) ||
      (!consensus.approved && consensus.direction !== "NO_SIGNAL")) {
    throw new Error(`${market}: five-agent 3-of-5 quorum report is incomplete or invalid`);
  }

  const framework = researchReports["FIVE-AGENT VALIDATION FRAMEWORK:"];
  if (framework?.holdoutAccess !== "LOCKED_UNTIL_CANDIDATE_SETTINGS_FROZEN" ||
      framework?.optimizationApplied !== false ||
      !Number.isInteger(framework?.totalClosedCandles) ||
      !Number.isInteger(framework?.trainingRange?.count) ||
      !Number.isInteger(framework?.holdoutRange?.count) ||
      framework.trainingRange.count + framework.holdoutRange.count !== framework.totalClosedCandles ||
      framework.holdoutRange.startIndex !== framework.trainingRange.endIndexExclusive) {
    throw new Error(`${market}: chronological validation or final 30% holdout protection is not verified`);
  }
  console.log(`${market}: five distinct agents executed; quorum ${consensus.direction}; holdout locked.`);

  for (const [marker, kind] of labels) {
    const matches = sectionLines.filter(value => value.includes(marker));
    if (matches.length !== 1) throw new Error(`${market}: expected exactly one ${kind} result; found ${matches.length}`);
    const raw = matches[0].slice(matches[0].indexOf(marker) + marker.length).trim();
    let report;
    try { report = JSON.parse(raw); }
    catch { throw new Error(`${market}: ${kind} agent returned invalid JSON`); }
    if (typeof report.approved !== "boolean") throw new Error(`${market}: ${kind} agent result is incomplete`);
    if (kind === "entry verification") {
      if (report.agent !== "LIVE_ENTRY_VERIFICATION_AGENT" ||
          !Number.isFinite(Date.parse(report.checkedAt))) {
        throw new Error(`${market}: entry-verification result is incomplete`);
      }
      const age = Date.now() - Date.parse(report.checkedAt);
      if (age < -60000 || age > 5 * 60 * 1000) {
        throw new Error(`${market}: verification result is not from this fresh snapshot`);
      }
      const quoteIsFresh = report.quoteValidationValid === true &&
        Number.isFinite(report.quoteAgeMs) && report.quoteAgeMs >= 0 &&
        report.quoteAgeMs <= maxQuoteAgeMs &&
        report.quote && Number(report.quote.bid) > 0 &&
        Number(report.quote.ask) > Number(report.quote.bid) &&
        report.quote.timestampQuality === "PROVIDER_TIMESTAMP";
      if (action === "BUY" || action === "SELL") {
        if (!quoteIsFresh) {
          throw new Error(`${market}: actionable ${action} lacks independently validated provider-timestamped bid/ask evidence (age limit ${maxQuoteAgeMs}ms)`);
        }
        if (report.approved !== true || report.decision !== action) {
          throw new Error(`${market}: actionable ${action} is not approved by independent entry verification`);
        }
      }
    }
  }
  console.log(`${market}: independent market-intelligence, signal-approval and entry-verification agents executed; final action ${action}.`);
}

console.log("SNAPSHOT VERIFICATION PASSED: all three markets contain five distinct research agents, a valid 3-of-5 quorum, locked chronological holdout metadata and three independent approval checks. This verifier does not approve trades.");
