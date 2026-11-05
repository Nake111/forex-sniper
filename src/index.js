
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

function explainMissing(name, result, side) {
  const conditions = side === "BUY"
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

  console.log(`\n${name} ${side} conditions:`);

  if (missing.length === 0) {
    console.log("All 4 conditions passed.");
  } else {
    missing.forEach(item => {
      console.log("MISSING:", item[0]);
    });
  }
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

  // Approximate Volume Profile over the latest 24 hours.
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

  const bullishVolume = currentPrice > volumeProfile.poc;
  const bearishVolume = currentPrice < volumeProfile.poc;

  console.log(
    "Price vs POC:",
    bullishVolume ? "ABOVE POC" :
    bearishVolume ? "BELOW POC" : "AT POC"
  );

  console.log("\nEUR/USD MARKET STRUCTURE");
  console.log("------------------------");

  console.log(
    "Swing High:",
    structure.swingHigh?.toFixed(5) ?? "Not found"
  );

  console.log(
    "Swing Low:",
    structure.swingLow?.toFixed(5) ?? "Not found"
  );

  console.log("Break of Structure:", structure.bos);

  console.log(
    "BOS Level:",
    structure.bosLevel?.toFixed(5) ?? "Not available"
  );

  console.log("Liquidity Sweep:", structure.liquiditySweep);

  console.log(
    "Sweep Level:",
    structure.liquiditySweepLevel?.toFixed(5) ?? "Not available"
  );

  console.log(
    "Sweep Bars Ago:",
    structure.liquiditySweepBarsAgo ?? "Not available"
  );

  console.log(
    "Sweep Confirmed:",
    structure.sweepConfirmed ? "YES" : "NO"
  );

  console.log(
    "Confirmation Bars Ago:",
    structure.sweepConfirmationBarsAgo ?? "Not available"
  );

  console.log(
    "Previous Day High:",
    structure.previousDayHigh?.toFixed(5) ?? "Not available"
  );

  console.log(
    "Previous Day Low:",
    structure.previousDayLow?.toFixed(5) ?? "Not available"
  );

  // All three timeframes must be fully aligned.
  const allBullish =
    m5Result.trend === "BULLISH" &&
    m15Result.trend === "BULLISH" &&
    h1Result.trend === "BULLISH";

  const allBearish =
    m5Result.trend === "BEARISH" &&
    m15Result.trend === "BEARISH" &&
    h1Result.trend === "BEARISH";

  // BOS can qualify independently.
  // A liquidity sweep must have a later candle confirmation.
  const bullishStructure =
    structure.bos === "BULLISH" ||
    (
      structure.liquiditySweep === "BULLISH" &&
      structure.sweepConfirmed === true
    );

  const bearishStructure =
    structure.bos === "BEARISH" ||
    (
      structure.liquiditySweep === "BEARISH" &&
      structure.sweepConfirmed === true
    );

  let signal = "HOLD";
  const reasons = [];

  if (direction === "BUY") {
    if (!allBullish) {
      reasons.push("All three timeframes are not fully bullish.");
      explainMissing("M5", m5Result, "BUY");
      explainMissing("M15", m15Result, "BUY");
      explainMissing("H1", h1Result, "BUY");
    }

    if (!bullishStructure) {
      if (
        structure.liquiditySweep === "BULLISH" &&
        structure.sweepConfirmed !== true
      ) {
        reasons.push(
          "Bullish sweep detected but not confirmed by a later candle close."
        );
      } else {
        reasons.push(
          "No bullish BOS or confirmed bullish liquidity sweep."
        );
      }
    }

    if (!bullishVolume) {
      reasons.push("Price is not above Volume Profile POC.");
    }

    if (allBullish && bullishStructure && bullishVolume) {
      signal = "BUY";
    }
  } else if (direction === "SELL") {
    if (!allBearish) {
      reasons.push("All three timeframes are not fully bearish.");
      explainMissing("M5", m5Result, "SELL");
      explainMissing("M15", m15Result, "SELL");
      explainMissing("H1", h1Result, "SELL");
    }

    if (!bearishStructure) {
      if (
        structure.liquiditySweep === "BEARISH" &&
        structure.sweepConfirmed !== true
      ) {
        reasons.push(
          "Bearish sweep detected but not confirmed by a later candle close."
        );
      } else {
        reasons.push(
          "No bearish BOS or confirmed bearish liquidity sweep."
        );
      }
    }

    if (!bearishVolume) {
      reasons.push("Price is not below Volume Profile POC.");
    }

    if (allBearish && bearishStructure && bearishVolume) {
      signal = "SELL";
    }
  } else {
    reasons.push("No dominant direction.");
  }

  // Readiness is a checklist completion score, NOT win probability.
  let readiness = null;

  if (direction === "BUY") {
    const gates = [
      m5Result.bullishVotes === 4,
      m15Result.bullishVotes === 4,
      h1Result.bullishVotes === 4,
      bullishStructure,
      bullishVolume
    ];

    readiness = gates.filter(Boolean).length;
  } else if (direction === "SELL") {
    const gates = [
      m5Result.bearishVotes === 4,
      m15Result.bearishVotes === 4,
      h1Result.bearishVotes === 4,
      bearishStructure,
      bearishVolume
    ];

    readiness = gates.filter(Boolean).length;
  }

  console.log("\n================================");
  console.log("SIGNAL READINESS REPORT");
  console.log("================================");

  console.log("Bullish votes:", bullishTotal, "/ 12");
  console.log("Bearish votes:", bearishTotal, "/ 12");
  console.log("Dominant direction:", direction);
  console.log("Directional agreement:", agreement + "%");

  if (readiness !== null) {
    console.log(
      "Trade readiness:",
      readiness,
      "/ 5 gates",
      `(${readiness * 20}%)`
    );
  } else {
    console.log("Trade readiness: NOT AVAILABLE");
  }

  console.log("Final signal:", signal);

  console.log("\nTRADE READINESS CHECKLIST");
  console.log("------------------------");

  if (direction === "BUY") {
    printTimeframeProgress("M5", m5Result, "BUY");
    printTimeframeProgress("M15", m15Result, "BUY");
    printTimeframeProgress("H1", h1Result, "BUY");

    printCheck("Bullish BOS or confirmed sweep", bullishStructure);
    printCheck("Price above POC", bullishVolume);
  } else if (direction === "SELL") {
    printTimeframeProgress("M5", m5Result, "SELL");
    printTimeframeProgress("M15", m15Result, "SELL");
    printTimeframeProgress("H1", h1Result, "SELL");

    printCheck("Bearish BOS or confirmed sweep", bearishStructure);
    printCheck("Price below POC", bearishVolume);
  } else {
    console.log("WAIT | No clear dominant direction.");
  }

  printCheck("Final BUY/SELL signal", signal !== "HOLD");

  if (signal === "HOLD") {
    console.log("\nEXACT REASONS FOR HOLD");

    reasons.forEach((reason, index) => {
      console.log(`${index + 1}. ${reason}`);
    });
  }

  if (signal !== "HOLD") {
    const entry = currentPrice;
    const atr = m5.latest.atr14;

    if (!Number.isFinite(atr) || atr <= 0) {
      throw new Error("Invalid ATR value; cannot calculate trade levels.");
    }

    const risk = atr * 1.5;
    const reward = atr * 3;

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
    console.log("\nTRADE LEVELS: NOT AVAILABLE — HOLD");
  }

  // News is background information only.
  // Headlines never change the technical signal.
  console.log("\nEUR/USD NEWS — LAST 24 HOURS");
  console.log("----------------------------");
  console.log("NEWS IS CONTEXT ONLY — NOT A SIGNAL INPUT.");

  try {
    const news = await getForexNews();

    if (!news.length) {
      console.log("No recent news articles returned.");
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
  console.log("Readiness percentage is NOT win probability.");
  console.log("Directional agreement is NOT win probability.");
  console.log("Volume Profile uses approximate tick-volume data.");
  console.log("Backtest before considering trading decisions.");
  console.log("================================");
}

main().catch(error => {
  console.error("Forex Sniper error:", error);
  process.exitCode = 1;
});
