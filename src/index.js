
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
  return {
    candles,
    latest: results[results.length - 1]
  };
}

function evaluateTimeframe(latest) {
  const bullish = [
    latest.close > latest.ema20,
    latest.ema20 > latest.ema50,
    latest.rsi14 > 50,
    latest.macd > latest.macdSignal
  ];

  const bearish = [
    latest.close < latest.ema20,
    latest.ema20 < latest.ema50,
    latest.rsi14 < 50,
    latest.macd < latest.macdSignal
  ];

  const bullishVotes = bullish.filter(Boolean).length;
  const bearishVotes = bearish.filter(Boolean).length;

  let trend = "NEUTRAL";

  if (bullishVotes === 4) trend = "BULLISH";
  if (bearishVotes === 4) trend = "BEARISH";

  return { trend, bullishVotes, bearishVotes };
}

function printTimeframe(name, latest, result) {
  console.log(`\n${name} TIMEFRAME`);
  console.log("------------------------");
  console.log("Close:", latest.close);
  console.log("EMA 20:", latest.ema20);
  console.log("EMA 50:", latest.ema50);
  console.log("RSI 14:", latest.rsi14);
  console.log("MACD:", latest.macd);
  console.log("MACD Signal:", latest.macdSignal);
  console.log("Bullish conditions:", result.bullishVotes, "/ 4");
  console.log("Bearish conditions:", result.bearishVotes, "/ 4");
  console.log("Trend:", result.trend);
}

function explainMissing(name, result, direction) {
  const conditions = direction === "BUY"
    ? [
        ["Price above EMA20", result.bullish[0]],
        ["EMA20 above EMA50", result.bullish[1]],
        ["RSI above 50", result.bullish[2]],
        ["MACD above signal", result.bullish[3]]
      ]
    : [
        ["Price below EMA20", result.bearish[0]],
        ["EMA20 below EMA50", result.bearish[1]],
        ["RSI below 50", result.bearish[2]],
        ["MACD below signal", result.bearish[3]]
      ];

  const missing = conditions.filter(item => !item[1]);

  console.log(`\n${name} missing ${direction} conditions:`);

  if (missing.length === 0) {
    console.log("All conditions confirmed.");
  } else {
    missing.forEach(item => console.log("- " + item[0]));
  }
}

function evaluateWithDetails(latest) {
  const result = evaluateTimeframe(latest);

  result.bullish = [
    latest.close > latest.ema20,
    latest.ema20 > latest.ema50,
    latest.rsi14 > 50,
    latest.macd > latest.macdSignal
  ];

  result.bearish = [
    latest.close < latest.ema20,
    latest.ema20 < latest.ema50,
    latest.rsi14 < 50,
    latest.macd < latest.macdSignal
  ];

  return result;
}

async function main() {
  console.log("================================");
  console.log("       FOREX SNIPER DESK");
  console.log("================================");

  const m5 = await loadTimeframe("eurusd-m5.json");
  const m15 = await loadTimeframe("eurusd-m15.json");
  const h1 = await loadTimeframe("eurusd-h1.json");

  const m5Result = evaluateWithDetails(m5.latest);
  const m15Result = evaluateWithDetails(m15.latest);
  const h1Result = evaluateWithDetails(h1.latest);

  printTimeframe("M5 ENTRY", m5.latest, m5Result);
  printTimeframe("M15 CONFIRMATION", m15.latest, m15Result);
  printTimeframe("H1 MAIN DIRECTION", h1.latest, h1Result);

  const bullishTotal =
    m5Result.bullishVotes +
    m15Result.bullishVotes +
    h1Result.bullishVotes;

  const bearishTotal =
    m5Result.bearishVotes +
    m15Result.bearishVotes +
    h1Result.bearishVotes;

  const direction = bullishTotal >= bearishTotal ? "BUY" : "SELL";
  const confidence = Math.round(
    Math.max(bullishTotal, bearishTotal) / 12 * 100
  );

  let signal = "HOLD";

  if (
    m5Result.trend === "BULLISH" &&
    m15Result.trend === "BULLISH" &&
    h1Result.trend === "BULLISH"
  ) {
    signal = "BUY";
  } else if (
    m5Result.trend === "BEARISH" &&
    m15Result.trend === "BEARISH" &&
    h1Result.trend === "BEARISH"
  ) {
    signal = "SELL";
  }

  console.log("\n================================");
  console.log("SIGNAL CONFIDENCE REPORT");
  console.log("================================");
  console.log("Bullish indicator votes:", bullishTotal, "/ 12");
  console.log("Bearish indicator votes:", bearishTotal, "/ 12");
  console.log("Dominant direction:", direction);
  console.log("Directional agreement score:", confidence + "%");
  console.log("Final signal:", signal);

  if (signal === "HOLD") {
    console.log("\nREASONS FOR HOLD:");

    explainMissing("M5", m5Result, direction);
    explainMissing("M15", m15Result, direction);
    explainMissing("H1", h1Result, direction);

    console.log("\nWaiting for all three timeframes to align.");
  }

  let entry = null;
  let stopLoss = null;
  let takeProfit = null;

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

    console.log("\nTRADE LEVELS — PAPER ONLY");
    console.log("Entry:", entry.toFixed(5));
    console.log("Stop Loss:", stopLoss.toFixed(5));
    console.log("Take Profit:", takeProfit.toFixed(5));
    console.log("Risk/Reward: 1:2");
  }

  const structure = analyzeMarketStructure(m5.candles);

  console.log("\nEUR/USD MARKET STRUCTURE");
  console.log("------------------------");
  console.log("Swing High:", structure.swingHigh ?? "Not found");
  console.log("Swing Low:", structure.swingLow ?? "Not found");
  console.log("Break of Structure:", structure.bos);
  console.log("Liquidity Sweep:", structure.liquiditySweep);
  console.log("Previous Day High:", structure.previousDayHigh ?? "Not available");
  console.log("Previous Day Low:", structure.previousDayLow ?? "Not available");

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
  console.log("Confidence is not win probability.");
  console.log("================================");
}

main().catch(error => {
  console.error("Forex Sniper error:", error);
  process.exitCode = 1;
});
