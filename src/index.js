
import { readFile } from "node:fs/promises";
import { analyseTimeframe } from "./market.js";
import { getForexNews } from "./news.js";

const VERSION = "3.7";

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
    .sort((a, b) => Number(a.time) - Number(b.time));

  if (candles.length < 60) {
    throw new Error(
      `${timeframe}: insufficient candles (${candles.length}).`
    );
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

  const momentumBias =
    !Number.isFinite(s.momentum) ? "N/A" :
    s.momentum > 0 ? "BULLISH" :
    s.momentum < 0 ? "BEARISH" : "NEUTRAL";

  console.log(`State: ${s.state ?? "N/A"}`);
  console.log(`Momentum: ${number(s.momentum, 7)}`);
  console.log(
    `Previous momentum: ${number(s.previousMomentum, 7)}`
  );
  console.log(`Momentum bias: ${momentumBias}`);
  console.log(`Momentum direction: ${s.direction ?? "N/A"}`);
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
    console.log(
      `Market structure: ${JSON.stringify(result.structure)}`
    );
  }

  if (result.smartMoney) {
    console.log(
      `Smart Money: ${JSON.stringify(result.smartMoney)}`
    );
  }

  printSqueeze(timeframe, result);
}

// ==========================================
// MULTI-TIMEFRAME SIGNAL ENGINE
// ==========================================

function evaluateSignal(results) {
  const m5 = results.M5;
  const m15 = results.M15;
  const h1 = results.H1;

  const structure = m5.structure ?? {};

  // Structure confirmation must match the trade direction.
  const bullishM5Confirmation =
    structure.bos === "BULLISH" ||
    structure.sweep === "BULLISH" ||
    (
      structure.sweepConfirmed === true &&
      structure.liquiditySweep === "BULLISH"
    );

  const bearishM5Confirmation =
    structure.bos === "BEARISH" ||
    structure.sweep === "BEARISH" ||
    (
      structure.sweepConfirmed === true &&
      structure.liquiditySweep === "BEARISH"
    );

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

  const abovePoc =
    Number.isFinite(m5.poc) &&
    m5.close > m5.poc;

  const belowPoc =
    Number.isFinite(m5.poc) &&
    m5.close < m5.poc;

  if (
    bullish &&
    bullishM5Confirmation &&
    abovePoc
  ) {
    return "BUY";
  }

  if (
    bearish &&
    bearishM5Confirmation &&
    belowPoc
  ) {
    return "SELL";
  }

  return "HOLD";
}

// ==========================================
// H1 TTM SQUEEZE CONFIRMATION
// ==========================================

function checkTradeConfirmation(signal, results) {
  if (signal === "HOLD") {
    return {
      status: "NO TRADE",
      reason: "Technical conditions do not meet entry rules."
    };
  }

  const h1 = results.H1.squeeze;

  if (!h1 || !Number.isFinite(h1.momentum)) {
    return {
      status: "WAIT",
      reason: "H1 TTM Squeeze data is unavailable."
    };
  }

  if (h1.state !== "SQUEEZE_RELEASED") {
    return {
      status: "WAIT",
      reason: `H1 squeeze state is ${h1.state}, not released.`
    };
  }

  if (
    signal === "BUY" &&
    !h1.direction?.startsWith("BULLISH")
  ) {
    return {
      status: "WAIT",
      reason: `H1 momentum conflicts with BUY: ${h1.direction}.`
    };
  }

  if (
    signal === "SELL" &&
    !h1.direction?.startsWith("BEARISH")
  ) {
    return {
      status: "WAIT",
      reason: `H1 momentum conflicts with SELL: ${h1.direction}.`
    };
  }

  return {
    status: "H1 ALIGNED",
    reason: `H1 squeeze supports ${signal}.`
  };
}

// ==========================================
// TRADE PLAN — SAFETY GATE
// ==========================================

function tradePlan(signal, result, confirmation) {
  // CRITICAL:
  // Never create entry, stop-loss or take-profit
  // unless H1 confirmation has passed.

  if (
    signal === "HOLD" ||
    confirmation?.status !== "H1 ALIGNED" ||
    !Number.isFinite(result.atr14) ||
    result.atr14 <= 0 ||
    !Number.isFinite(result.close)
  ) {
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

  if (signal === "SELL") {
    return {
      entry,
      stopLoss: entry + risk,
      takeProfit: entry - reward,
      riskReward: "1:2"
    };
  }

  return null;
}

// ==========================================
// FOREX NEWS
// ==========================================

async function printNews() {
  console.log("\n========== FOREX NEWS ==========");

  try {
    const news = await getForexNews();

    if (
      !news ||
      (Array.isArray(news) && news.length === 0)
    ) {
      console.log("No news data available.");
      return;
    }

    console.log(JSON.stringify(news, null, 2));
  } catch (error) {
    console.log(`News unavailable: ${error.message}`);
  }
}

// ==========================================
// MAIN
// ==========================================

async function main() {
  console.log("======================================");
  console.log(`FOREX SNIPER AI v${VERSION}`);
  console.log("EUR/USD MULTI-TIMEFRAME ANALYSIS");
  console.log("M5 + M15 + H1");
  console.log("SMART MONEY + TTM SQUEEZE");
  console.log("H1 CONFIRMATION SAFETY GATE");
  console.log("PAPER ANALYSIS ONLY - LIVE ORDERS DISABLED");
  console.log("======================================");

  const results = {};

  for (const timeframe of ["M5", "M15", "H1"]) {
    const candles = await loadCandles(timeframe);

    results[timeframe] = analyseTimeframe(candles);

    console.log(
      `${timeframe} candles loaded: ${candles.length}`
    );

    printTimeframe(timeframe, results[timeframe]);
  }

  // Calculate the technical signal.
  const signal = evaluateSignal(results);

  // Check whether H1 confirms the technical signal.
  const confirmation = checkTradeConfirmation(
    signal,
    results
  );

  // A trade plan is possible only after H1 alignment.
  const plan = tradePlan(
    signal,
    results.M5,
    confirmation
  );

  console.log("\n========== FINAL SIGNAL ==========");

  console.log(`TECHNICAL SIGNAL: ${signal}`);
  console.log(`TRADE CONFIRMATION: ${confirmation.status}`);

  // Final action is never BUY or SELL while H1 says WAIT.
  console.log(
    `FINAL ACTION: ${plan ? signal : "NO TRADE"}`
  );

  console.log(
    `Confirmation reason: ${confirmation.reason}`
  );

  if (plan) {
    console.log("\n========== CONFIRMED TRADE PLAN ==========");

    console.log(`Entry reference: ${price(plan.entry)}`);
    console.log(`Stop Loss reference: ${price(plan.stopLoss)}`);
    console.log(`Take Profit reference: ${price(plan.takeProfit)}`);
    console.log(`Risk/Reward: ${plan.riskReward}`);
  } else if (
    signal !== "HOLD" &&
    confirmation.status !== "H1 ALIGNED"
  ) {
    console.log("\nNO TRADE PLAN");
    console.log("H1 confirmation has not passed.");
    console.log("Wait for higher-timeframe alignment.");
    console.log("Entry, stop-loss and take-profit are suppressed.");
  } else {
    console.log("\nNo valid entry. Waiting for confirmation.");
  }

  // ========================================
  // SQUEEZE SUMMARY
  // ========================================

  console.log("\n========== SQUEEZE SUMMARY ==========");

  for (const timeframe of ["M5", "M15", "H1"]) {
    const s = results[timeframe].squeeze;

    console.log(
      `${timeframe}: ${s?.state ?? "N/A"} | ` +
      `${s?.direction ?? "N/A"} | ` +
      `Momentum: ${number(s?.momentum, 7)}`
    );
  }

  // ========================================
  // ORDER BLOCK SUMMARY
  // ========================================

  console.log("\n========== ORDER BLOCK SUMMARY ==========");

  for (const timeframe of ["M5", "M15", "H1"]) {
    const blocks = results[timeframe].smartMoney?.orderBlocks ?? [];

    console.log(`\n${timeframe}:`);

    if (blocks.length === 0) {
      console.log("No valid Order Blocks found.");
      continue;
    }

    for (const block of blocks) {
      console.log(
        `${block.direction} OB | ` +
        `High: ${price(block.high)} | ` +
        `Low: ${price(block.low)} | ` +
        `Status: ${block.status}`
      );
    }
  }

  console.log("\n======================================");
  console.log("H1 confirmation is a filter, not a guarantee.");
  console.log("No live orders are placed.");
  console.log("======================================");

  await printNews();

  console.log("\n========== ANALYSIS COMPLETE ==========");
}

main().catch(error => {
  console.error("FOREX SNIPER ERROR:", error);
  process.exitCode = 1;
});
