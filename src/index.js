
import { readFile } from "node:fs/promises";
import { analyseTimeframe } from "./market.js";
import { getForexNews } from "./news.js";

const VERSION = "3.5";

const DATA_FILES = {
  M5: "data/eurusd-m5.json",
  M15: "data/eurusd-m15.json",
  H1: "data/eurusd-h1.json"
};

const RULES = {
  M5: 3,
  M15: 3,
  H1: 2,
  H1_STRONG_OPPOSITION: 3
};

function price(value) {
  return Number.isFinite(value) ? value.toFixed(5) : "N/A";
}

function number(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "N/A";
}

async function loadCandles(timeframe) {
  const raw = await readFile(DATA_FILES[timeframe], "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`${timeframe}: candle file is not an array.`);
  }

  const candles = parsed
    .map(c => ({
      time: c.timestamp,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume ?? 0)
    }))
    .filter(c =>
      [c.open, c.high, c.low, c.close].every(Number.isFinite)
    )
    .sort((a, b) => {
      const ta = Number(a.time);
      const tb = Number(b.time);
      return ta - tb;
    });

  if (candles.length < 60) {
    throw new Error(`${timeframe}: insufficient candles (${candles.length}).`);
  }

  return candles;
}

function printSqueeze(timeframe, result) {
  const s = result.squeeze;

  console.log(`\n${timeframe} TTM SQUEEZE`);

  if (!s) {
    console.log("Status: NOT AVAILABLE");
    return;
  }

  console.log(`State: ${s.state ?? "N/A"}`);
  console.log(`Momentum: ${number(s.momentum, 7)}`);
  console.log(`Previous momentum: ${number(s.previousMomentum, 7)}`);
  console.log(`Direction: ${s.direction ?? "N/A"}`);
  console.log(`Bullish momentum: ${s.bullish ?? "N/A"}`);
  console.log(`Bearish momentum: ${s.bearish ?? "N/A"}`);
}

function printTimeframe(timeframe, result) {
  console.log(`\n========== ${timeframe} ANALYSIS ==========`);

  console.log(`Close: ${price(result.close)}`);
  console.log(`EMA20: ${price(result.ema20)}`);
  console.log(`EMA50: ${price(result.ema50)}`);
  console.log(`RSI14: ${number(result.rsi14)}`);
  console.log(`MACD: ${number(result.macd, 7)}`);
  console.log(`MACD Signal: ${number(result.macdSignal, 7)}`);
  console.log(`MACD Histogram: ${number(result.macdHistogram, 7)}`);
  console.log(`ATR14: ${number(result.atr14, 6)}`);
  console.log(`Volume Profile POC: ${price(result.poc)}`);

  console.log(`Bullish votes: ${result.bullishVotes}/4`);
  console.log(`Bearish votes: ${result.bearishVotes}/4`);

  if (result.structure) {
    console.log(`Market structure: ${JSON.stringify(result.structure)}`);
  }

  if (result.smartMoney) {
    console.log(`Smart Money: ${JSON.stringify(result.smartMoney)}`);
  }

  printSqueeze(timeframe, result);
}

function evaluateSignal(results) {
  const m5 = results.M5;
  const m15 = results.M15;
  const h1 = results.H1;

  const bullish =
    m5.bullishVotes >= RULES.M5 &&
    m15.bullishVotes >= RULES.M15 &&
    h1.bullishVotes >= RULES.H1 &&
    h1.bearishVotes < RULES.H1_STRONG_OPPOSITION;

  const bearish =
    m5.bearishVotes >= RULES.M5 &&
    m15.bearishVotes >= RULES.M15 &&
    h1.bearishVotes >= RULES.H1 &&
    h1.bullishVotes < RULES.H1_STRONG_OPPOSITION;

  const m5Structure = m5.structure ?? {};
  const m5Confirmation =
    m5Structure.bos === "BULLISH" ||
    m5Structure.bos === "BEARISH" ||
    m5Structure.sweep === "BULLISH" ||
    m5Structure.sweep === "BEARISH" ||
    m5Structure.sweepConfirmed === true;

  const abovePoc =
    Number.isFinite(m5.poc) && m5.close > m5.poc;

  const belowPoc =
    Number.isFinite(m5.poc) && m5.close < m5.poc;

  if (bullish && m5Confirmation && abovePoc) return "BUY";
  if (bearish && m5Confirmation && belowPoc) return "SELL";

  return "HOLD";
}

function tradePlan(signal, result) {
  if (signal === "HOLD" || !Number.isFinite(result.atr14)) {
    return null;
  }

  const entry = result.close;
  const risk = result.atr14 * 1.5;
  const reward = result.atr14 * 3;

  if (signal === "BUY") {
    return {
      entry,
      stopLoss: entry - risk,
      takeProfit: entry + reward,
      riskReward: "1:2"
    };
  }

  return {
    entry,
    stopLoss: entry + risk,
    takeProfit: entry - reward,
    riskReward: "1:2"
  };
}

async function printNews() {
  console.log("\n========== FOREX NEWS ==========");

  try {
    const news = await getForexNews();

    if (!news || (Array.isArray(news) && news.length === 0)) {
      console.log("No news data available.");
      return;
    }

    console.log(JSON.stringify(news, null, 2));
  } catch (error) {
    console.log(`News unavailable: ${error.message}`);
  }
}

async function main() {
  console.log("======================================");
  console.log(`FOREX SNIPER AI v${VERSION}`);
  console.log("EUR/USD MULTI-TIMEFRAME ANALYSIS");
  console.log("TTM SQUEEZE INTEGRATION");
  console.log("PAPER ANALYSIS ONLY - LIVE ORDERS DISABLED");
  console.log("======================================");

  const results = {};

  for (const timeframe of ["M5", "M15", "H1"]) {
    const candles = await loadCandles(timeframe);
    results[timeframe] = analyseTimeframe(candles);
    console.log(`${timeframe} candles loaded: ${candles.length}`);
    printTimeframe(timeframe, results[timeframe]);
  }

  const signal = evaluateSignal(results);
  const plan = tradePlan(signal, results.M5);

  console.log("\n========== FINAL SIGNAL ==========");
  console.log(`SIGNAL: ${signal}`);

  if (plan) {
    console.log(`Entry: ${price(plan.entry)}`);
    console.log(`Stop Loss: ${price(plan.stopLoss)}`);
    console.log(`Take Profit: ${price(plan.takeProfit)}`);
    console.log(`Risk/Reward: ${plan.riskReward}`);
  } else {
    console.log("No valid entry. Waiting for confirmation.");
  }

  console.log("\n========== SQUEEZE SUMMARY ==========");

  for (const timeframe of ["M5", "M15", "H1"]) {
    const squeeze = results[timeframe].squeeze;
    console.log(
      `${timeframe}: ${squeeze?.state ?? "NOT AVAILABLE"} | ` +
      `${squeeze?.direction ?? "N/A"}`
    );
  }

  console.log("\nTTM Squeeze is an additional volatility/momentum tool.");
  console.log("It does not independently trigger BUY or SELL.");

  await printNews();

  console.log("\n========== ANALYSIS COMPLETE ==========");
}

main().catch(error => {
  console.error("FOREX SNIPER ERROR:", error);
  process.exitCode = 1;
});
