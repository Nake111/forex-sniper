import { readFile, writeFile, rename } from "node:fs/promises";

const SIGNALS = "dashboard/data/signals.json";
const MARKET_DATA = "dashboard/data/latest.json";
const EXPECTED = ["EURUSD", "BTCUSD", "XAUUSD"];
const MAX_SIGNAL_AGE_MS = Number(process.env.WATCHDOG_MAX_SIGNAL_AGE_MS ?? 10 * 60 * 1000);
const MAX_CANDLE_AGE_MS = Number(process.env.WATCHDOG_MAX_CANDLE_AGE_MS ?? 10 * 60 * 1000);
const MAX_QUOTE_AGE_MS = Number(process.env.WATCHDOG_MAX_QUOTE_AGE_MS ?? 15_000);
const now = Date.now();

const [signals, marketData] = await Promise.all([
  readFile(SIGNALS, "utf8").then(JSON.parse),
  readFile(MARKET_DATA, "utf8").then(JSON.parse)
]);

const failures = [];
const signalTime = Date.parse(signals.generatedAt ?? "");
if (!Number.isFinite(signalTime) || now - signalTime > MAX_SIGNAL_AGE_MS || signalTime > now + 60_000) {
  failures.push("Signal publication is missing, stale, or future-dated");
}
const signalCycle = signals.analysisCycle?.id;
const dataCycle = marketData.analysisCycle?.id;
if (!signalCycle || signalCycle !== dataCycle) failures.push("Signal and candle snapshots do not share one analysis cycle");
if (marketData.validation?.status !== "PASS") failures.push("Market-data validation is not PASS");
if (Object.keys(signals.markets ?? {}).length !== EXPECTED.length) failures.push("Signal snapshot has missing or unexpected markets");

const perMarket = {};
const closedCandleTimes = new Set();
for (const id of EXPECTED) {
  const candle = marketData.markets?.[id]?.timeframes?.M5;
  const signal = signals.markets?.[id];
  const issues = [];
  const candleTime = Date.parse(candle?.latestClosedAt ?? "");
  const candleAge = Number.isFinite(candleTime) ? now - candleTime : Infinity;
  if (candle?.status !== "PASS" || !Number.isFinite(candleTime) ||
      candleAge < -60_000 || candleAge > MAX_CANDLE_AGE_MS) {
    issues.push("M5 provider candle is missing, failed, or stale");
  }
  if (candle?.gapCount !== 0) issues.push("M5 provider data contains interval gaps");
  if (Number.isFinite(candleTime)) closedCandleTimes.add(new Date(candleTime).toISOString());
  if (!signal) issues.push("Market signal is missing");
  if (signal && signal.analysisCycle?.id !== signalCycle) issues.push("Market signal has a mismatched analysis cycle");

  const quote = signal?.quote;
  const quoteTime = Number(quote?.timestamp);
  const quoteAge = Number.isFinite(quoteTime) ? now - quoteTime : Infinity;
  if (quote?.validated !== true || quote?.timestampQuality !== "PROVIDER_TIMESTAMP" ||
      !(Number(quote?.bid) > 0) || !(Number(quote?.ask) > Number(quote?.bid)) ||
      quoteAge < -60_000 || quoteAge > MAX_QUOTE_AGE_MS) {
    issues.push("Live provider bid/ask is missing, invalid, or stale");
  }
  perMarket[id] = { issues, candleAgeMs: Number.isFinite(candleAge) ? Math.round(candleAge) : null,
    quoteAgeMs: Number.isFinite(quoteAge) ? Math.round(quoteAge) : null };
}

if (closedCandleTimes.size !== 1) failures.push("Markets do not share the same latest closed M5 candle timestamp");
const globalFailure = failures.length > 0;
for (const [id, result] of Object.entries(perMarket)) {
  if (globalFailure || result.issues.length) {
    const market = signals.markets[id];
    if (market) {
      market.decision = "NO APPROVED TRADE";
      market.status = "REJECTED_OR_UNVERIFIED";
      market.paperApproval = { status: "NOT_APPROVED", approved: false, decision: "NO APPROVED TRADE" };
      market.entry = null;
      market.stopLoss = null;
      market.takeProfit = null;
      market.riskReward = null;
      market.verification = market.verification ?? {};
      market.verification.watchdog = "BLOCKED";
      market.verification.watchdogFailures = [...failures, ...result.issues];
      market.verification.blockers = [...new Set([...(market.verification.blockers ?? []),
        ...failures, ...result.issues, "Watchdog fail-closed protection"])];
    }
  } else if (signals.markets[id]) {
    signals.markets[id].verification = signals.markets[id].verification ?? {};
    signals.markets[id].verification.watchdog = "PASS";
    signals.markets[id].verification.watchdogFailures = [];
  }
}

signals.watchdog = {
  checkedAt: new Date(now).toISOString(),
  status: globalFailure || Object.values(perMarket).some(x => x.issues.length) ? "BLOCKED" : "PASS",
  thresholds: { maxSignalAgeMs: MAX_SIGNAL_AGE_MS, maxCandleAgeMs: MAX_CANDLE_AGE_MS, maxQuoteAgeMs: MAX_QUOTE_AGE_MS },
  globalFailures: failures,
  markets: perMarket
};

const temp = SIGNALS + ".watchdog.tmp";
await writeFile(temp, JSON.stringify(signals, null, 2) + "\n");
await rename(temp, SIGNALS);
console.log("WATCHDOG:", signals.watchdog.status);
console.log(JSON.stringify(signals.watchdog, null, 2));
if (signals.watchdog.status !== "PASS") {
  console.error("FAIL-CLOSED: stale or inconsistent data detected; affected markets published as NO APPROVED TRADE.");
  process.exitCode = 2;
}
