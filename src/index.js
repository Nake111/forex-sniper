import { readFile, writeFile } from "node:fs/promises";
import { analyseTimeframe } from "./market.js";
import { tradePlan, finalAction } from "./trade-plan.js";
import { evaluateSignal } from "./signal.js";
import { analyseDonchian, evaluateDonchianSignal } from "./donchian-strategy.js";
import { evaluateCombinedSignal } from "./combined-signal.js";

const MIN_HISTORY = 220;
const INTERVALS = { M5: 5 * 60 * 1000, M15: 15 * 60 * 1000, H1: 60 * 60 * 1000 };
const MAX_AGE = { M5: 20 * 60 * 1000, M15: 45 * 60 * 1000, H1: 2 * 60 * 60 * 1000 };

function getTime(candle) {
  const raw = candle.timestamp ?? candle.time ?? candle.date;
  const time = typeof raw === "number" ? raw : Date.parse(raw);
  if (!Number.isFinite(time)) return NaN;
  return time < 1e12 ? time * 1000 : time;
}

async function loadCandles(path, timeframe) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  const candles = raw.map(c => ({
    ...c,
    timestamp: getTime(c),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume ?? 0)
  })).filter(c =>
    Number.isFinite(c.timestamp) &&
    [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
    c.high >= c.low &&
    c.timestamp + INTERVALS[timeframe] <= Date.now()
  ).sort((a, b) => a.timestamp - b.timestamp);

  if (candles.length < MIN_HISTORY) {
    throw new Error(timeframe + ": need at least " + MIN_HISTORY + " closed candles; found " + candles.length);
  }
  return candles.slice(-300);
}

function printTimeframe(name, result) {
  console.log("\\n" + name + " ANALYSIS");
  console.log("-----------------------");
  for (const key of ["close", "ema20", "ema50", "ema200", "rsi14", "macd", "macdSignal", "atr14", "poc", "valueAreaHigh", "valueAreaLow"]) {
    console.log(key + ":", result[key]);
  }
  console.log("BOS:", result.structure.bos, "bars ago:", result.structure.bosBarsAgo);
  console.log("Liquidity sweep:", result.structure.liquiditySweep, "confirmed:", result.structure.sweepConfirmed);
  console.log("Squeeze:", result.squeeze.state, result.squeeze.direction);
  console.log("SMC swing:", result.smartMoney.swing);
  console.log("Bullish/Bearish votes:", result.bullishVotes, "/", result.bearishVotes);
}

async function main() {
  console.log("======================================");
  console.log("       BTCUSD FOREX SNIPER AI");
  console.log("       COMBINED SIGNAL ENGINE");
  console.log("Live execution: DISABLED");
  console.log("======================================");

  const [m5, m15, h1] = await Promise.all([
    loadCandles("data/btcusd-m5.json", "M5"),
    loadCandles("data/btcusd-m15.json", "M15"),
    loadCandles("data/btcusd-h1.json", "H1")
  ]);

  const results = {
    M5: analyseTimeframe(m5),
    M15: analyseTimeframe(m15),
    H1: analyseTimeframe(h1)
  };
  printTimeframe("M5", results.M5);
  printTimeframe("M15", results.M15);
  printTimeframe("H1", results.H1);

  const donchian = {
    M5: analyseDonchian(m5),
    M15: analyseDonchian(m15),
    H1: analyseDonchian(h1)
  };
  const legacySignal = evaluateSignal(results);
  const donchianSignal = evaluateDonchianSignal(donchian);

  const freshness = { ok: true, reasons: [] };
  for (const name of ["M5", "M15", "H1"]) {
    const candles = name === "M5" ? m5 : name === "M15" ? m15 : h1;
    const age = Date.now() - (candles.at(-1).timestamp + INTERVALS[name]);
    if (age < 0 || age > MAX_AGE[name]) {
      freshness.ok = false;
      freshness.reasons.push(name + " closed candle is stale: " + Math.round(age / 60000) + " minutes old");
    }
  }

  const combined = evaluateCombinedSignal({ results, donchian, legacySignal, freshness });
  const signal = combined.signal;
  const confirmation = { status: combined.confirmation };
  const plan = tradePlan(signal, results.M5, confirmation);
  const action = finalAction(signal, plan);
  const record = {
    schemaVersion: 2,
    symbol: "BTCUSD",
    generatedAt: new Date().toISOString(),
    dataSource: "Dukascopy historical rates; not a direct Vantage feed",
    signalBarTime: new Date(m5.at(-1).timestamp).toISOString(),
    candleCounts: { M5: m5.length, M15: m15.length, H1: h1.length },
    freshness,
    legacySignal,
    donchianSignal,
    combinedSignal: signal,
    confirmation: combined.confirmation,
    scores: combined.scores,
    reasons: combined.reasons,
    bullishEvidence: combined.bullishEvidence,
    bearishEvidence: combined.bearishEvidence,
    blockers: combined.blockers,
    action,
    plan: plan ? {
      entry: plan.entry,
      stopLoss: plan.stopLoss,
      takeProfit: plan.takeProfit,
      riskReward: plan.riskReward
    } : null
  };
  await writeFile("data/latest-signal.json", JSON.stringify(record, null, 2) + "\\n", "utf8");

  console.log("\\n========== FINAL BTCUSD SIGNAL ==========");
  console.log("LEGACY SMC SIGNAL:", legacySignal);
  console.log("DONCHIAN SIGNAL:", donchianSignal);
  console.log("COMBINED SIGNAL:", signal);
  console.log("CONFIRMATION:", combined.confirmation);
  console.log("EVIDENCE SCORE:", combined.scores);
  console.log("REASONS:", combined.reasons);
  console.log("BLOCKERS:", combined.blockers);
  console.log("DATA SOURCE:", record.dataSource);
  console.log("CANDLE COUNTS:", record.candleCounts);
  if (plan) {
    console.log("ENTRY REFERENCE:", plan.entry);
    console.log("STOP LOSS:", plan.stopLoss);
    console.log("TAKE PROFIT:", plan.takeProfit);
    console.log("RISK / REWARD:", plan.riskReward);
  } else {
    console.log("NO TRADE: no confirmed entry. Do not force a position.");
  }
  console.log("Signal saved: data/latest-signal.json");
  console.log("No orders have been placed.");
}

main().catch(error => {
  console.error("BTCUSD ANALYSIS ERROR:", error);
  process.exitCode = 1;
});
