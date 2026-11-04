import { readFile } from "node:fs/promises";
import { calculateIndicators } from "./indicators.js";

async function main() {
  console.log("FOREX SNIPER");
  console.log("EUR/USD — Educational Analysis");
  console.log("Live trading: Disabled");

  const raw = await readFile("data/eurusd-m5.json", "utf8");
  const candles = JSON.parse(raw);

  if (!Array.isArray(candles) || candles.length < 50) {
    throw new Error("Not enough candle data for analysis");
  }

  const results = calculateIndicators(candles);
  const latest = results[results.length - 1];

  let signal = "HOLD";

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

  console.log("\nLATEST EUR/USD ANALYSIS");
  console.log("-----------------------");
  console.log("Candles:", candles.length);
  console.log("Close:", latest.close);
  console.log("EMA 20:", latest.ema20);
  console.log("EMA 50:", latest.ema50);
  console.log("RSI 14:", latest.rsi14);
  console.log("MACD:", latest.macd);
  console.log("MACD Signal:", latest.macdSignal);
  console.log("ATR 14:", latest.atr14);
  console.log("\nSIGNAL:", signal);
}

main().catch(error => {
  console.error("Analysis failed:", error);
  process.exitCode = 1;
});
