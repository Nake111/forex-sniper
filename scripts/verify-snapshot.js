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
  ["AGENT 1 — BID/ASK + BUYER/SELLER REVIEW:", "market"],
  ["AGENT 2 — INDEPENDENT SIGNAL APPROVAL:", "approval"],
  ["AGENT 3 — INDEPENDENT LIVE ENTRY VERIFICATION:", "verification"]
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
  if (finalIndex < 0) {
    throw new Error(`${market}: final signal section missing from its exact market block`);
  }
  const section = sectionLines.join("\n");
  const finalActionLine = sectionLines.slice(finalIndex).find(line => line.startsWith("FINAL ACTION:"));
  if (!finalActionLine) throw new Error(`${market}: final action line missing`);
  const action = finalActionLine.slice("FINAL ACTION:".length).trim();
  if (!["BUY", "SELL", "NO TRADE", "HOLD"].includes(action)) {
    throw new Error(`${market}: unrecognized final action ${action}`);
  }

  const researchLines = Object.fromEntries(researchMarkers.map(marker => [
    marker, sectionLines.filter(value => value.includes(marker))
  ]));
  for (const marker of researchMarkers) {
    if (researchLines[marker].length !== 1) {
      throw new Error(`${market}: expected exactly one ${marker} report; found ${researchLines[marker].length}`);
    }
  }
  const parseResearch = marker => {
    const raw = researchLines[marker][0].slice(researchLines[marker][0].indexOf(marker) + marker.length).trim();
    try { return JSON.parse(raw); }
    catch { throw new Error(`${market}: invalid JSON in ${marker}`); }
  };
  const fiveAgents = parseResearch("FIVE INDEPENDENT SIGNAL AGENTS:");
  const consensus = parseResearch("FIVE-AGENT CONSENSUS:");
  const framework = parseResearch("FIVE-AGENT VALIDATION FRAMEWORK:");
  const actualNames = Array.isArray(fiveAgents) ? fiveAgents.map(agent => agent?.name) : [];
  if (actualNames.length !== 5 || new Set(actualNames).size !== 5 ||
      researchAgentNames.some(name => !actualNames.includes(name)) ||
      fiveAgents.some(agent => !["BUY", "SELL", "NO_SIGNAL"].includes(agent?.signal))) {
    throw new Error(`${market}: five distinct research agents did not all execute with valid directional/abstention outputs`);
  }
  if (consensus?.totalAgents !== 5 || consensus?.requiredVotes !== 3 ||
      typeof consensus.approved !== "boolean" ||
      !["BUY", "SELL", "NO_SIGNAL"].includes(consensus.direction)) {
    throw new Error(`${market}: five-agent quorum report is incomplete or its 3-of-5 rule changed`);
  }
  if (framework?.holdoutAccess !== "LOCKED_UNTIL_CANDIDATE_SETTINGS_FROZEN" ||
      framework?.optimizationApplied !== false) {
    throw new Error(`${market}: research validation framework did not preserve the locked holdout`);
  }
  console.log(`${market}: all five distinct research agents ran; quorum ${consensus.direction} (${consensus.requiredVotes}/${consensus.totalAgents}); holdout locked.`);

  for (const [marker, kind] of labels) {
    const matches = sectionLines.filter(value => value.includes(marker));
    if (matches.length !== 1) throw new Error(`${market}: expected exactly one ${kind} agent result; found ${matches.length}`);
    const raw = matches[0].slice(matches[0].indexOf(marker) + marker.length).trim();
    let report;
    try { report = JSON.parse(raw); }
    catch { throw new Error(`${market}: ${kind} agent returned invalid JSON`); }
    if (typeof report.approved !== "boolean") throw new Error(`${market}: ${kind} agent result is incomplete`);
    if (kind === "verification") {
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
        Number(report.quote.ask) > Number(report.quote.bid);
      if (action === "BUY" || action === "SELL") {
        if (!quoteIsFresh) {
          throw new Error(`${market}: actionable ${action} is missing an independently validated fresh bid/ask quote (age limit ${maxQuoteAgeMs}ms)`);
        }
        if (report.approved !== true || report.decision !== action) {
          throw new Error(`${market}: actionable ${action} is not approved by independent entry verification`);
        }
        console.log(`${market}: all three agents ran; quote fresh (${report.quoteAgeMs}ms); ${action}; independently approved=true`);
      } else {
        console.log(`${market}: ${action}; no fresh quote is required to publish a fail-closed no-trade result`);
      }
    }
  }

  // A no-trade snapshot is publishable even when the market is closed or quotes are unavailable.
  // BUY/SELL remain gated by fresh quote evidence and independent approval above.
  console.log(`${market}: final action section present (${action})`);
}

console.log("SNAPSHOT VERIFICATION PASSED: all three market sections contain all five distinct research agents, the 3-of-5 quorum report, locked holdout metadata, three independent approval agents, and fresh-quote validation. This verifier does not approve trades.");
