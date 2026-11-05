import { readFile } from "node:fs/promises";
import { calculateIndicators } from "./indicators.js";
import { analyzeMarketStructure } from "./market-structure.js";
import { calculateVolumeProfile } from "./volume-profile.js";
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
  let phase = "MIXED";

  if (bullishVotes === 4) {
    trend = "BULLISH";
    phase = "CONFIRMED BULLISH";
  } else if (bearishVotes === 4) {
    trend = "BEARISH";
    phase = "CONFIRMED BEARISH";
  } else if (bullishVotes >= 3) {
    phase = "DEVELOPING BULLISH";
  } else if (bearishVotes >= 3) {
    phase = "DEVELOPING BEARISH";
  }

  return {
    trend,
    phase,
    bullishVotes,
    bearishVotes,
    bullish,
    bearish
  };
}

function printTimeframe(name, latest, result) {
  console.log(`\n${name}`);
  console.log("------------------------");
  console.log("Close:", latest.close);
  console.log("EMA 20:", latest.ema20);
  console.log("EMA 50:", latest.ema50);
  console.log("RSI 14:", latest.rsi14);
  console.log("MACD:", latest.macd);
  console.log("MACD Signal:", latest.macdSignal);
  console.log("Bullish votes:", result.bullishVotes, "/ 4");
  console.log("Bearish votes:", result.bearishVotes, "/ 4");
  console.log("Trend:", result.trend);
  console.log("Trend phase:", result.phase);
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

function printCheck(label, passed) {
  console.log(`${passed ? "PASS" : "WAIT"} | ${label}`);
}

function printTimeframeProgress(name, result, side) {
  const votes = side === "BUY"
    ? result.bullishVotes
    : result.bearishVotes;

  const phase = votes === 4
    ? "CONFIRMED"
    : votes === 3
      ? "DEVELOPING"
      : "WAIT";

  console.log(
    `${phase} | ${name} ${side} conditions (${votes}/4)`
  );
}

async function main() {
  console.log("================================");
  console.log("       FOREX SNIPER DESK");
  console.log("================================");

  const m5 = await loadTimeframe("eurusd-m5.json");
  const m15 = await loadTimeframe("eurusd-m15.json");
  const h1 = await loadTimeframe("eurusd-h1.json");

  const m5Result = evaluateTimeframe(m5.latest);
  const m15Result = evaluateTimeframe(m15.latest);
  const h1Result = evaluateTimeframe(h1.latest);

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

  const direction = bullishTotal > bearishTotal
    ? "BUY"
    : bearishTotal > bullishTotal
      ? "SELL"
      : "NEUTRAL";

  const agreement = Math.round(
    Math.max(bullishTotal, bearishTotal) / 12 * 100
  );

  const structure = analyzeMarketStructure(m5.candles);

  // Approximate Volume Profile using the latest 24 hours.
  const profileCandles = m5.candles.slice(-288);

  const volumeProfile = calculateVolumeProfile(
    profileCandles,
    24,
    0.70
  );

  const currentPrice = m5.latest.close;

  console.log("\nVOLUME PROFILE");
  console.log("------------------------");
  console.log("POC:", volumeProfile.poc.toFixed(5));
  console.log(
    "Value Area High:",
    volumeProfile.valueAreaHigh.toFixed(5)
  );
  console.log(
    "Value Area Low:",
    volumeProfile.valueAreaLow.toFixed(5)
  );

  const priceVsPoc = currentPrice > volumeProfile.poc
    ? "ABOVE POC"
    : currentPrice < volumeProfile.poc
      ? "BELOW POC"
      : "AT POC";

  console.log("Price vs POC:", priceVsPoc);

  console.log("\nEUR/USD MARKET STRUCTURE");
  console.log("------------------------");
  console.log("Swing High:", structure.swingHigh ?? "Not found");
  console.log("Swing Low:", structure.swingLow ?? "Not found");
  console.log("Break of Structure:", structure.bos);
  console.log("Liquidity Sweep:", structure.liquiditySweep);
  console.log(
    "Previous Day High:",
    structure.previousDayHigh ?? "Not available"
  );
  console.log(
    "Previous Day Low:",
    structure.previousDayLow ?? "Not available"
  );

  // Strict confirmation: all three timeframes must be 4/4.
  const allBullish =
    m5Result.trend === "BULLISH" &&
    m15Result.trend === "BULLISH" &&
    h1Result.trend === "BULLISH";

  const allBearish =
    m5Result.trend === "BEARISH" &&
    m15Result.trend === "BEARISH" &&
    h1Result.trend === "BEARISH";

  const bullishStructure =
    structure.bos === "BULLISH" ||
    structure.liquiditySweep === "BULLISH";

  const bearishStructure =
    structure.bos === "BEARISH" ||
    structure.liquiditySweep === "BEARISH";

  const bullishVolume = currentPrice > volumeProfile.poc;
  const bearishVolume = currentPrice < volumeProfile.poc;

  let signal = "HOLD";
  const reasons = [];

  if (allBullish) {
    if (!bullishStructure) {
      reasons.push(
        "No bullish break of structure or bullish liquidity sweep."
      );
    }

    if (!bullishVolume) {
      reasons.push("Price is not above Volume Profile POC.");
    }

    if (bullishStructure && bullishVolume) {
      signal = "BUY";
    }
  } else if (allBearish) {
    if (!bearishStructure) {
      reasons.push(
        "No bearish break of structure or bearish liquidity sweep."
      );
    }

    if (!bearishVolume) {
      reasons.push("Price is not below Volume Profile POC.");
    }

    if (bearishStructure && bearishVolume) {
      signal = "SELL";
    }
  } else {
    reasons.push(
      "M5, M15 and H1 are not all aligned."
    );
  }

  console.log("\n================================");
  console.log("SIGNAL CONFIDENCE REPORT");
  console.log("================================");
  console.log("Bullish votes:", bullishTotal, "/ 12");
  console.log("Bearish votes:", bearishTotal, "/ 12");
  console.log("Dominant direction:", direction);
  console.log("Directional agreement:", agreement + "%");
  console.log("Final signal:", signal);

  if (signal === "HOLD") {
    console.log("\nREASONS FOR HOLD:");

    if (!allBullish && !allBearish && direction !== "NEUTRAL") {
      explainMissing("M5", m5Result, direction);
      explainMissing("M15", m15Result, direction);
      explainMissing("H1", h1Result, direction);
    }

    reasons.forEach(reason => console.log("- " + reason));
  }

  console.log("\n================================");
  console.log("TRADE READINESS CHECKLIST");
  console.log("================================");

  if (direction === "BUY") {
    printTimeframeProgress("M5", m5Result, "BUY");
    printTimeframeProgress("M15", m15Result, "BUY");
    printTimeframeProgress("H1", h1Result, "BUY");

    printCheck("Bullish market structure", bullishStructure);
    printCheck("Price above POC", bullishVolume);
    printCheck(
      "Final BUY signal (strict confirmation)",
      signal === "BUY"
    );
  } else if (direction === "SELL") {
    printTimeframeProgress("M5", m5Result, "SELL");
    printTimeframeProgress("M15", m15Result, "SELL");
    printTimeframeProgress("H1", h1Result, "SELL");

    printCheck("Bearish market structure", bearishStructure);
    printCheck("Price below POC", bearishVolume);
    printCheck(
      "Final SELL signal (strict confirmation)",
      signal === "SELL"
    );
  } else {
    console.log("WAIT | No clear dominant direction.");
  }

  if (signal !== "HOLD") {
    const entry = currentPrice;
    const risk = m5.latest.atr14 * 1.5;
    const reward = m5.latest.atr14 * 3;

    const stopLoss = signal === "BUY"
      ? entry - risk
      : entry + risk;

    const takeProfit = signal === "BUY"
      ? entry + reward
      : entry - reward;

    console.log("\nTRADE LEVELS — PAPER ONLY");
    console.log("Entry:", entry.toFixed(5));
    console.log("Stop Loss:", stopLoss.toFixed(5));
    console.log("Take Profit:", takeProfit.toFixed(5));
    console.log("Risk/Reward: 1:2");
  } else {
    console.log(
      "\nTRADE LEVELS: NOT AVAILABLE — HOLD"
    );
  }

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
  console.log("Directional agreement is not win probability.");
  console.log("Volume Profile is an approximate tick-volume proxy.");
  console.log("Backtest before considering any trading decision.");
  console.log("================================");
}

main().catch(error => {
  console.error("Forex Sniper error:", error);
  process.exitCode = 1;
});
