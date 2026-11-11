import { readFile } from "node:fs/promises";

const file = process.argv[2] ?? "market-snapshot.txt";
const maxQuoteAgeMs = Number(process.env.MAX_SNAPSHOT_QUOTE_AGE_MS ?? 15000);
const log = await readFile(file, "utf8");
const markets = ["EURUSD", "BTCUSD", "XAUUSD"];\nconst headers = { EURUSD: "EUR/USD SNIPER AI", BTCUSD: "BTC/USD SNIPER AI", XAUUSD: "XAU/USD (Gold) SNIPER AI" };
const labels = [
  ["AGENT 1 — BID/ASK + BUYER/SELLER REVIEW:", "market"],
  ["AGENT 2 — INDEPENDENT SIGNAL APPROVAL:", "approval"],
  ["AGENT 3 — INDEPENDENT LIVE ENTRY VERIFICATION:", "verification"]
];

function readJsonAfter(marker, market) {
  const lines = log.split(/\r?\n/);
  const line = lines.find(value => value.includes(marker));
  if (!line) throw new Error(`${market}: missing ${marker}`);
  const raw = line.slice(line.indexOf(marker) + marker.length).trim();
  try { return JSON.parse(raw); }
  catch { throw new Error(`${market}: malformed JSON from ${marker}`); }
}

for (const market of markets) {
  const start = log.indexOf(`FINAL ${market} SIGNAL`);
  if (start < 0) throw new Error(`${market}: final signal section missing`);
  const next = markets.map(name => log.indexOf(`FINAL ${name} SIGNAL`, start + 1))
    .filter(index => index > start).sort((a, b) => a - b)[0] ?? log.length;
  const section = log.slice(start, next);

  for (const [marker, kind] of labels) {
    const line = section.split(/\r?\n/).find(value => value.includes(marker));
    if (!line) throw new Error(`${market}: ${kind} agent did not run`);
    const raw = line.slice(line.indexOf(marker) + marker.length).trim();
    let report;
    try { report = JSON.parse(raw); }
    catch { throw new Error(`${market}: ${kind} agent returned invalid JSON`); }

    if (kind === "market" && typeof report.approved !== "boolean") {
      throw new Error(`${market}: market-intelligence result is incomplete`);
    }
    if (kind === "approval" && typeof report.approved !== "boolean") {
      throw new Error(`${market}: approval result is incomplete`);
    }
    if (kind === "verification") {
      if (report.agent !== "LIVE_ENTRY_VERIFICATION_AGENT" ||
          typeof report.approved !== "boolean" ||
          !Number.isFinite(Date.parse(report.checkedAt))) {
        throw new Error(`${market}: entry-verification result is incomplete`);
      }
      const checkedAtAge = Date.now() - Date.parse(report.checkedAt);
      if (checkedAtAge < -60000 || checkedAtAge > 5 * 60 * 1000) {
        throw new Error(`${market}: verification result is not from this fresh snapshot`);
      }
      if (report.quoteValidationValid !== true ||
          !Number.isFinite(report.quoteAgeMs) ||
          report.quoteAgeMs < 0 || report.quoteAgeMs > maxQuoteAgeMs ||
          !report.quote || !(Number(report.quote.bid) > 0) ||
          !(Number(report.quote.ask) > Number(report.quote.bid))) {
        throw new Error(`${market}: no independently validated fresh bid/ask quote (age limit ${maxQuoteAgeMs}ms)`);
      }
      console.log(`${market}: three agents ran; quote fresh (${report.quoteAgeMs}ms); decision ${report.decision}; approved ${report.approved}`);
    }
  }
}

console.log("SNAPSHOT VERIFICATION PASSED: all three markets have complete three-agent reviews and fresh validated bid/ask quotes.");
