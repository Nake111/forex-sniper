
import { readFile } from "node:fs/promises";
import { calculateIndicators } from "./indicators.js";
import { getForexNews } from "./news.js";

async function main() {
  console.log("================================");
  console.log("       FOREX SNIPER DESK");
  console.log("================================");

  // 1. Load EUR/USD candle data
  const raw = await readFile("data/eurusd-m5.json", "utf8");
  const candles = JSON.parse(raw);

  if (!Array.isArray(candles) || candles.length < 50) {
    throw new Error("Not enough candle data");
  }

  // 2. Calculate technical indicators
  const results = calculateIndicators(candles);
  const latest = results[results.length - 1];

  // 3. Generate trading signal
  let signal = "HOLD";
  let entry = null;
  let stopLoss = null;
  let takeProfit = null;

  if (
    latest.close > latest.ema20 &&
    latest.ema20 > latest.ema50 &&
    latest.rsi14 >= 50 &&
    latest.rsi14 <= 70 &&
    latest.macd > latest.macdSignal
  ) {
    signal = "BUY";
  } else if (
    latest.close < latest.ema20 &&
    latest.ema20 < latest.ema50 &&
    latest.rsi14 >= 30 &&
    latest.rsi14 <= 50 &&
    latest.macd < latest.macdSignal
  ) {
    signal = "SELL";
  }

  // 4. Calculate hypothetical risk levels
  if (signal !== "HOLD") {
    entry = latest.close;
    const risk = latest.atr14 * 1.5;
    const reward = latest.atr14 * 3;

    if (signal === "BUY") {
      stopLoss = entry - risk;
      takeProfit = entry + reward;
    } else {
      stopLoss = entry + risk;
      takeProfit = entry - reward;
    }
  }

  // 5. Print technical analysis
  console.log("\nEUR/USD TECHNICAL ANALYSIS");
  console.log("--------------------------");
  console.log("Candles:", candles.length);
  console.log("Close:", latest.close);
  console.log("EMA 20:", latest.ema20);
  console.log("EMA 50:", latest.ema50);
  console.log("RSI 14:", latest.rsi14);
  console.log("MACD:", latest.macd);
  console.log("MACD Signal:", latest.macdSignal);
  console.log("ATR 14:", latest.atr14);

  console.log("\nSIGNAL:", signal);

  if (signal !== "HOLD") {
    console.log("ENTRY:", entry.toFixed(5));
    console.log("STOP LOSS:", stopLoss.toFixed(5));
    console.log("TAKE PROFIT:", takeProfit.toFixed(5));
    console.log("RISK/REWARD: 1:2");
  } else {
    console.log("Waiting for confirmation.");
  }

  // 6. Load free GDELT news
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
