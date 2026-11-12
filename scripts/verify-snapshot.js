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
const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
      if (report.quoteValidationValid !== true ||
          !Number.isFinite(report.quoteAgeMs) || report.quoteAgeMs < 0 ||
          report.quoteAgeMs > maxQuoteAgeMs ||
          !report.quote || !(Number(report.quote.bid) > 0) ||
          !(Number(report.quote.ask) > Number(report.quote.bid))) {
        throw new Error(`${market}: no independently validated fresh bid/ask quote (age limit ${maxQuoteAgeMs}ms)`);
      }
      console.log(`${market}: all three agents ran; quote fresh (${report.quoteAgeMs}ms); ${report.decision}; approved=${report.approved}`);
    }
  }

  // The final decision is evidence, not an approval shortcut. A blocked decision
  // is a valid snapshot; only the independent agents and quote checks above gate it.
  const finalAction = sectionLines.slice(finalIndex).find(line => line.startsWith("FINAL ACTION:"));
  if (!finalAction) throw new Error(`${market}: final action line missing`);
  const action = finalAction.slice("FINAL ACTION:".length).trim();
  if (!["BUY", "SELL", "NO TRADE", "HOLD"].includes(action)) {
    throw new Error(`${market}: unrecognized final action ${action}`);
  }
  console.log(`${market}: final action section present (${action})`);
}

console.log("SNAPSHOT VERIFICATION PASSED: all three market sections contain exactly one result from each independent agent, fresh validated bid/ask evidence, and a final decision. This verifier does not approve trades.");
