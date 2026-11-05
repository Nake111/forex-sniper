import { readFile } from "node:fs/promises";
import { calculateIndicators } from "./indicators.js";
import { analyzeMarketStructure } from "./market-structure.js";
import { getForexNews } from "./news.js";

async function loadTimeframe(filename) {
  const raw = await readFile(`data/${filename}`, "utf8");
  const candles = JSON.parse(raw);

  if (!Array.isArray(candles) || candles.length < 50) {
    throw new Error(`Not enough data in ${filename}`);
  }

  const results = calculateIndicators(candles);
  const latest = results[results.length - 1];

  return { candles, latest };
}

function getTrend(latest) {
  if (
    latest.close > latest.ema20 &&
    latest.ema20 > latest.ema50 &&
    latest.rsi14 > 50 &&
    latest.macd > latest.macdSignal
  ) {
    return "BULLISH";
  }

  if (
    latest.close < latest.ema20 &&
    latest.ema20 < latest.ema50 &&
    latest.rsi14 < 50 &&
    latest.macd < latest.macdSignal
  ) {
    return "BEARISH";
  }

  return "NEUTRAL";
}

function printTimeframe(name, latest, trend) {
  console.log(`\n${name} TIMEFRAME`);
  console.log("------------------------");
  console.log("Close:", latest.close);
  console.log("EMA 20:", latest.ema20);
  console.log("EMA 50:", latest.ema50);
  console.log("RSI 14:", latest.rsi14);
  console.log("MACD:", latest.macd);
  console.log("MACD Signal:", latest.macdSignal);
  console.log("Trend:", trend);
}

async function main() {
  console.log("================================");
  console.log("       FOREX SNIPER DESK");
  console.log("================================");

  // Load all three timeframes
  const m5 = await loadTimeframe("eurusd-m5.json");
  const m15 = await loadTimeframe("eurusd-m15.json");
  const h1 = await loadTimeframe("eurusd-h1.json");

  const m5Trend = getTrend(m5.latest);
  const m15Trend = getTrend(m15.latest);
  const h1Trend = getTrend(h1.latest);

  // Display timeframe analysis
  printTimeframe("M5 ENTRY", m5.latest, m5Trend);
  printTimeframe("M15 CONFIRMATION", m15.latest, m15Trend);
  printTimeframe("H1 MAIN DIRECTION", h1.latest, h1Trend);

  // Only trade when all three timeframes agree
  let signal = "HOLD";
  let entry = null;
  let stopLoss = null;
  let takeProfit = null;

  if (
    m5Trend === "BULLISH" &&
    m15Trend === "BULLISH" &&
    h1Trend === "BULLISH"
  ) {
    signal = "BUY";
  } else if (
    m5Trend === "BEARISH" &&
    m15Trend === "BEARISH" &&
    h1Trend === "BEARISH"
  ) {
    signal = "SELL";
  }

  // Calculate hypothetical risk levels using M5 ATR
  if (signal !== "HOLD") {
    entry = m5.latest.close;
    const risk = m5.latest.atr14 * 1.5;
    const reward = m5.latest.atr14 * 3;

    if (signal === "BUY") {
      stopLoss = entry - risk;
      takeProfit = entry + reward;
    } else {
      stopLoss = entry + risk;
      takeProfit = entry - reward;
    }
  }

  console.log("\n================================");
  console.log("MULTI-TIMEFRAME SIGNAL");
  console.log("================================");
  console.log("H1:", h1Trend);
  console.log("M15:", m15Trend);
  console.log("M5:", m5Trend);
  console.log("\nFINAL SIGNAL:", signal);

  if (signal !== "HOLD") {
    console.log("ENTRY:", entry.toFixed(5));
    console.log("STOP LOSS:", stopLoss.toFixed(5));
    console.log("TAKE PROFIT:", takeProfit.toFixed(5));
    console.log("RISK/REWARD: 1:2");
  } else {
    console.log("No full timeframe alignment. Waiting for confirmation.");
  }

  // M5 market structure
  const structure = analyzeMarketStructure(m5.candles);

  console.log("\nEUR/USD MARKET STRUCTURE");
  console.log("------------------------");
  console.log("Swing High:", structure.swingHigh ?? "Not found");
  console.log("Swing Low:", structure.swingLow ?? "Not found");
  console.log("Break of Structure:", structure.bos);
  console.log("Liquidity Sweep:", structure.liquiditySweep);
  console.log("Previous Day High:", structure.previousDayHigh ?? "Not available");
  console.log("Previous Day Low:", structure.previousDayLow ?? "Not available");

  // News report
  console.log("\nEUR/USD NEWS — LAST 24 HOURS");
  console.log("----------------------------");

  try {
    const news = await getForexNews();

    if (!news.length) {
      console.log("No news articles returned.");
    }

    for (const [index, article] of news.entries()) {
      console.log(`\n${index + 1}. ${article.title}`);
      console.log("Source:", article.source || "Unknown");
      console.log("Date:", article.date || "Unknown");
      console.log("URL:", article.url);
    }
  } catch (error) {
    console.log("News feed unavailable:", error.message);
  }

  console.log("\n================================");
  console.log("LIVE TRADING: DISABLED");
  console.log("PAPER ANALYSIS ONLY");
  console.log("================================");
}

main().catch(error => {
  console.error("Forex Sniper error:", error);
  process.exitCode = 1;
});
