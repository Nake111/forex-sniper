import { readFile } from "node:fs/promises";

const file = process.argv[2] ?? "dashboard/data/signals.json";
const maxAgeMs = Number(process.env.MAX_PUBLICATION_AGE_MS ?? 15 * 60 * 1000);
const raw = await readFile(file, "utf8");
const data = JSON.parse(raw);
const now = Date.now();
const generatedAt = Date.parse(data.generatedAt ?? "");
const cycleAt = Date.parse(data.analysisCycle?.timestampUtc ?? "");
const expected = ["EURUSD", "BTCUSD", "XAUUSD"];

if (data.schemaVersion !== 1) throw new Error("Unsupported publication schema");
if (data.mode !== "PAPER_RESEARCH_ONLY") throw new Error("Publication is not marked PAPER_RESEARCH_ONLY");
if (data.timeZone !== "Europe/Ljubljana") throw new Error("Publication timezone is missing or incorrect");
if (!Number.isFinite(generatedAt) || now - generatedAt < -60_000 || now - generatedAt > maxAgeMs) {
  throw new Error("Published dashboard data is stale or future-dated");
}
if (!Number.isFinite(cycleAt) || !data.analysisCycle?.id ||
    new Date(cycleAt).toISOString() !== data.analysisCycle.id) {
  throw new Error("Shared analysis-cycle timestamp is invalid");
}
if (data.analysisCycle.timeZone !== "Europe/Ljubljana" ||
    typeof data.analysisCycle.timestampSlovenia !== "string" ||
    !data.analysisCycle.timestampSlovenia) {
  throw new Error("Shared Slovenia analysis-cycle timestamp is missing");
}
if (!data.markets || Object.keys(data.markets).sort().join(",") !== expected.slice().sort().join(",")) {
  throw new Error("Publication must contain exactly EURUSD, BTCUSD and XAUUSD");
}

for (const id of expected) {
  const market = data.markets[id];
  if (market.analysisCycle?.id !== data.analysisCycle.id) {
    throw new Error(id + ": market does not belong to the latest shared analysis cycle");
  }
  if (!["BUY", "SELL", "NO APPROVED TRADE"].includes(market.decision)) {
    throw new Error(id + ": invalid published decision " + market.decision);
  }
  if (!Number.isFinite(Date.parse(market.generatedAt)) ||
      Date.parse(market.generatedAt) !== generatedAt) {
    throw new Error(id + ": publication timestamp does not match the dashboard cycle");
  }
  if (!Array.isArray(market.verification?.blockers)) {
    throw new Error(id + ": blocker list is missing");
  }
  if (market.brokerExecution?.executable !== false ||
      market.brokerExecution?.connected !== false) {
    throw new Error(id + ": broker execution must remain disabled");
  }
  if (market.decision === "BUY" || market.decision === "SELL") {
    if (market.paperApproval?.approved !== true ||
        market.paperApproval?.decision !== market.decision ||
        market.quote?.validated !== true ||
        !Number.isFinite(market.entry) ||
        !Number.isFinite(market.stopLoss) ||
        !Number.isFinite(market.takeProfit) ||
        !Number.isFinite(market.riskReward)) {
      throw new Error(id + ": directional signal lacks complete paper-approval evidence");
    }
    if (market.verification.blockers.length) {
      throw new Error(id + ": approved signal still contains blockers");
    }
  } else if (market.paperApproval?.approved === true) {
    throw new Error(id + ": rejected decision conflicts with approved paper status");
  }
  console.log(id + ": " + market.decision + " | " +
    (market.decision === "NO APPROVED TRADE"
      ? "blockers=" + market.verification.blockers.length
      : "paper approval verified"));
}

console.log("PUBLICATION VERIFIED: all markets share the latest analysis cycle; timestamps, decisions, blockers and paper-only execution controls are valid.");
