import { readFile, writeFile, rename } from "node:fs/promises";
import { fetchBidAskQuotes } from "../src/bid-ask-quotes.js";
import { createQuoteSnapshot } from "../src/quote-snapshot.js";

const file = "dashboard/data/signals.json";
const markets = ["EURUSD", "BTCUSD", "XAUUSD"];
const maxDriftAtr = { EURUSD: 0.2, BTCUSD: 0.25, XAUUSD: 0.2 };
const signals = JSON.parse(await readFile(file, "utf8"));
const feed = await fetchBidAskQuotes({ markets });
const checkedAt = Date.now();
const failures = [];

for (const market of markets) {
  const signal = signals.markets?.[market];
  if (!signal) {
    failures.push(market + ": signal missing");
    continue;
  }

  signal.analysisQuote ??= signal.quote ?? null;
  const snapshot = createQuoteSnapshot(feed.quotes?.[market] ?? null, market, checkedAt);
  if (!snapshot.valid) {
    const providerErrors = (feed.errors ?? []).filter(error => String(error).startsWith(market + ":"));
    const reason = providerErrors.join("; ") || snapshot.blockers.join("; ") || "No fresh provider quote";
    signal.quoteRefresh = { status: "BLOCKED", checkedAt: new Date(checkedAt).toISOString(), reason };
    signal.quote = {
      bid: null, ask: null, timestamp: null, timestampQuality: null,
      source: null, venue: null, ageMs: null, validated: false
    };
    failures.push(market + ": " + reason);
    if (signal.decision === "BUY" || signal.decision === "SELL") {
      signal.decision = "NO APPROVED TRADE";
      signal.status = "REJECTED_OR_UNVERIFIED";
      signal.paperApproval = { status: "NOT_APPROVED", approved: false, decision: "NO APPROVED TRADE" };
      signal.entry = signal.stopLoss = signal.takeProfit = signal.riskReward = null;
    }
    continue;
  }

  const quote = snapshot.quote;
  signal.quote = {
    market,
    bid: quote.bid,
    ask: quote.ask,
    timestamp: quote.timestamp,
    receivedAt: quote.receivedAt,
    timestampQuality: quote.timestampQuality,
    source: quote.source,
    venue: quote.venue,
    tradeable: quote.tradeable !== false,
    ageMs: snapshot.validation.ageMs,
    receiveAgeMs: snapshot.receiveAgeMs,
    validated: true,
    snapshotId: snapshot.snapshotId
  };
  signal.quoteRefresh = {
    status: "PASS",
    checkedAt: new Date(checkedAt).toISOString(),
    providerTimestamp: new Date(quote.timestamp).toISOString(),
    ageMs: snapshot.validation.ageMs,
    source: quote.source,
    venue: quote.venue
  };

  // A newly refreshed publication quote is not silently substituted into an
  // already-approved entry. Re-check executable-side drift and live R:R; if
  // either gate fails, downgrade to NO APPROVED TRADE.
  if (signal.decision === "BUY" || signal.decision === "SELL") {
    const direction = signal.decision;
    const plan = signal.candidatePlan;
    const entry = direction === "BUY" ? quote.ask : quote.bid;
    const reference = Number(plan?.signalReferenceEntry ?? plan?.entry);
    const atr = Number(signal.m5Atr14);
    const stop = Number(plan?.stopLoss);
    const target = Number(plan?.takeProfit);
    const driftAtr = Number.isFinite(reference) && Number.isFinite(atr) && atr > 0
      ? Math.abs(entry - reference) / atr : Infinity;
    const risk = direction === "BUY" ? entry - stop : stop - entry;
    const reward = direction === "BUY" ? target - entry : entry - target;
    const liveRiskReward = risk > 0 && reward > 0 ? reward / risk : NaN;
    const blockers = [];
    if (!Number.isFinite(driftAtr) || driftAtr > maxDriftAtr[market]) {
      blockers.push("Final provider quote moved beyond the market-specific entry-drift limit");
    }
    if (!Number.isFinite(liveRiskReward) || liveRiskReward < 2) {
      blockers.push("Final provider quote no longer preserves minimum 1:2 risk/reward");
    }
    if (blockers.length) {
      signal.decision = "NO APPROVED TRADE";
      signal.status = "REJECTED_OR_UNVERIFIED";
      signal.paperApproval = { status: "NOT_APPROVED", approved: false, decision: "NO APPROVED TRADE" };
      signal.entry = signal.stopLoss = signal.takeProfit = signal.riskReward = null;
      signal.verification ??= {};
      signal.verification.blockers = [...new Set([...(signal.verification.blockers ?? []), ...blockers])];
      signal.quoteRefresh.downgradeReasons = blockers;
    } else {
      const formatted = "1:" + liveRiskReward.toFixed(2);
      signal.entry = entry;
      signal.candidatePlan.entry = entry;
      signal.candidatePlan.riskRewardValue = liveRiskReward;
      signal.candidatePlan.riskReward = formatted;
      signal.riskReward = formatted;
    }
  }
}

signals.quoteRefresh = {
  status: failures.length ? "BLOCKED" : "PASS",
  checkedAt: new Date(checkedAt).toISOString(),
  provider: feed.provider ?? null,
  failures
};
const temporary = file + ".quote-refresh.tmp";
await writeFile(temporary, JSON.stringify(signals, null, 2) + "\n");
await rename(temporary, file);
console.log("FINAL PUBLICATION QUOTE REFRESH:", signals.quoteRefresh.status);
for (const market of markets) {
  const q = signals.markets?.[market]?.quote;
  console.log(market + ": " + (q?.validated ? "FRESH" : "BLOCKED") +
    " | age=" + (q?.ageMs ?? "n/a") + "ms | " + (q?.source ?? "no provider quote"));
}
if (failures.length) {
  console.error("QUOTE REFRESH FAILED CLOSED:", failures.join(" | "));
  process.exitCode = 1;
}
