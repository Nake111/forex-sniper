import { readFile, writeFile, rename } from "node:fs/promises";
import { evaluateLiveMarketSync } from "../src/live-market-sync.js";

const signalsPath = "dashboard/data/signals.json";
const marketDataPath = "dashboard/data/latest.json";
const [signals, marketData] = await Promise.all([
  readFile(signalsPath, "utf8").then(JSON.parse),
  readFile(marketDataPath, "utf8").then(JSON.parse)
]);
const result = evaluateLiveMarketSync({
  signals,
  marketData,
  maxQuoteAgeMs: Number(process.env.MAX_SYNC_QUOTE_AGE_MS ?? 15_000),
  maxQuoteSkewMs: Number(process.env.MAX_SYNC_QUOTE_SKEW_MS ?? 15_000),
  maxCandleAgeMs: Number(process.env.MAX_SYNC_M5_AGE_MS ?? 600_000)
});
signals.liveMarketSynchronization = result;
if (result.status !== "PASS") {
  for (const market of Object.values(signals.markets ?? {})) {
    market.decision = "NO APPROVED TRADE";
    market.status = "REJECTED_OR_UNVERIFIED";
    market.paperApproval = { status: "NOT_APPROVED", approved: false, decision: "NO APPROVED TRADE" };
    market.entry = market.stopLoss = market.takeProfit = market.riskReward = null;
    market.verification ??= {};
    market.verification.watchdog = "BLOCKED";
    market.verification.blockers = [...new Set([...(market.verification.blockers ?? []),
      ...result.failures, "Live market synchronization fail-closed protection"])];
  }
}
const temp = signalsPath + ".sync.tmp";
await writeFile(temp, JSON.stringify(signals, null, 2) + "\n");
await rename(temp, signalsPath);
console.log("LIVE MARKET SYNCHRONIZATION:", result.status);
console.log(JSON.stringify(result, null, 2));
if (result.status !== "PASS") {
  console.error("FAIL-CLOSED: all markets remain NO APPROVED TRADE until synchronized evidence passes.");
  process.exitCode = 2;
}
