import { readFile } from "node:fs/promises";
import { analyseTimeframe } from "./market.js";
import { tradePlan, finalAction } from "./trade-plan.js";
import { evaluateSignal, confirmSignal } from "./signal.js";

const WINDOW = 240;
const MIN_HISTORY = 60;

const MARKETS = [
  { symbol: "EURUSD", label: "EUR/USD", prefix: "eurusd", interval: 0.00001 },
  { symbol: "BTCUSD", label: "BTC/USD", prefix: "btcusd", interval: 0.01 }
];

const TIMEFRAMES = [
  { key: "M5", file: "m5", milliseconds: 5 * 60 * 1000 },
  { key: "M15", file: "m15", milliseconds: 15 * 60 * 1000 },
  { key: "H1", file: "h1", milliseconds: 60 * 60 * 1000 }
];

function getTime(candle) {
  const raw = candle.timestamp ?? candle.time ?? candle.date;
  const time = typeof raw === "number" ? raw : Date.parse(raw);
  if (!Number.isFinite(time)) return NaN;
  return time < 1e12 ? time * 1000 : time;
}

async function loadCandles(path, timeframe, interval) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`${path}: expected candle array`);

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
    c.high >= Math.max(c.open, c.close, c.low) &&
    c.low <= Math.min(c.open, c.close, c.high) &&
    c.timestamp + interval <= Date.now()
  ).sort((a, b) => a.timestamp - b.timestamp);

  const unique = candles.filter((c, i) =>
    i === 0 || c.timestamp !== candles[i - 1].timestamp
  );

  if (unique.length < MIN_HISTORY) {
    throw new Error(`${timeframe}: only ${unique.length} valid closed candles; need ${MIN_HISTORY}`);
  }
  return unique.slice(-WINDOW);
}

function printTimeframe(name, result) {
  console.log(`\n${name} ANALYSIS`);
  console.log("-----------------------");
  console.log("Close:", result.close);
  console.log("EMA 20 / 50:", result.ema20, "/", result.ema50);
  console.log("RSI 14:", result.rsi14);
  console.log("MACD / Signal:", result.macd, "/", result.macdSignal);
  console.log("ATR 14:", result.atr14);
  console.log("ADX 14:", result.adx14);
  console.log("POC / VAH / VAL:", result.poc, "/", result.valueAreaHigh, "/", result.valueAreaLow);
  console.log("BOS / Sweep:", result.structure.bos, "/", result.structure.sweep);
  console.log("H1 squeeze:", result.squeeze.state, result.squeeze.direction);
  console.log("Bullish / Bearish votes:", result.bullishVotes, "/", result.bearishVotes);
}

async function analyseMarket(market) {
  console.log("\n======================================");
  console.log(`       ${market.label} SNIPER AI`);
  console.log("     Multi-Timeframe Analysis");
  console.log("======================================");
  console.log("Live trading: DISABLED");

  const frames = await Promise.all(TIMEFRAMES.map(async tf => ({
    key: tf.key,
    candles: await loadCandles(`data/${market.prefix}-${tf.file}.json`, tf.key, tf.milliseconds)
  })));

  const results = Object.fromEntries(frames.map(({ key, candles }) =>
    [key, analyseTimeframe(candles)]
  ));

  for (const tf of TIMEFRAMES) printTimeframe(tf.key, results[tf.key]);

  const candidate = evaluateSignal(results);
  const confirmation = confirmSignal(candidate, results.H1);
  const plan = tradePlan(candidate, results.M5, confirmation);
  const action = finalAction(candidate, plan);

  console.log("\n======================================");
  console.log(`          FINAL ${market.symbol} SIGNAL`);
  console.log("======================================");
  console.log("CANDIDATE:", candidate);
  console.log("CONFIRMATION:", confirmation.status);
  if (confirmation.reason) console.log("REASON:", confirmation.reason);
  console.log("FINAL ACTION:", action);

  if (plan) {
    console.log("ENTRY:", plan.entry.toFixed(market.symbol === "EURUSD" ? 5 : 2));
    console.log("STOP LOSS:", plan.stopLoss.toFixed(market.symbol === "EURUSD" ? 5 : 2));
    console.log("TAKE PROFIT:", plan.takeProfit.toFixed(market.symbol === "EURUSD" ? 5 : 2));
    console.log("RISK / REWARD:", plan.riskReward);
  } else {
    console.log("No confirmed trade. Wait for a valid setup.");
  }

  for (const { key, candles } of frames) console.log(`${key} closed candles:`, candles.length);
  console.log("Paper analysis only — no orders sent.");
}

async function main() {
  const outcomes = await Promise.allSettled(MARKETS.map(analyseMarket));
  let failed = false;
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "rejected") {
      failed = true;
      console.error(`\n${MARKETS[index].label} ANALYSIS ERROR:`, outcome.reason);
    }
  });
  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error("FOREX SNIPER ERROR:", error);
  process.exitCode = 1;
});
