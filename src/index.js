
import { readFile } from "node:fs/promises";
import { analyseTimeframe } from "./market.js";
import { tradePlan, finalAction } from "./trade-plan.js";

const WINDOW = 120;
const MIN_HISTORY = 60;

function getTime(candle) {
  const raw = candle.timestamp ?? candle.time ?? candle.date;
  let time = typeof raw === "number" ? raw : Date.parse(raw);

  if (!Number.isFinite(time)) return NaN;
  return time < 1e12 ? time * 1000 : time;
}

async function loadCandles(path, timeframe, interval) {
  const raw = JSON.parse(await readFile(path, "utf8"));

  const candles = raw
    .map(c => ({
      ...c,
      timestamp: getTime(c),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume ?? 0)
    }))
    .filter(c =>
      Number.isFinite(c.timestamp) &&
      [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
      c.high >= c.low &&
      c.timestamp + interval <= Date.now()
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  if (candles.length < MIN_HISTORY) {
    throw new Error(`${timeframe}: not enough closed candles`);
  }

  return candles.slice(-WINDOW);
}

function evaluateSignal({ M5, M15, H1 }) {
  const s = M5.structure ?? {};

  const bullishStructure =
    s.bos === "BULLISH" ||
    s.sweep === "BULLISH" ||
    (s.sweepConfirmed && s.liquiditySweep === "BULLISH");

  const bearishStructure =
    s.bos === "BEARISH" ||
    s.sweep === "BEARISH" ||
    (s.sweepConfirmed && s.liquiditySweep === "BEARISH");

  const bullish =
    M5.bullishVotes >= 3 &&
    M15.bullishVotes >= 3 &&
    H1.bullishVotes >= 2 &&
    H1.bearishVotes < 3;

  const bearish =
    M5.bearishVotes >= 3 &&
    M15.bearishVotes >= 3 &&
    H1.bearishVotes >= 2 &&
    H1.bullishVotes < 3;

  if (
    bullish &&
    bullishStructure &&
    Number.isFinite(M5.poc) &&
    M5.close > M5.poc
  ) return "BUY";

  if (
    bearish &&
    bearishStructure &&
    Number.isFinite(M5.poc) &&
    M5.close < M5.poc
  ) return "SELL";

  return "HOLD";
}

function confirmSignal(signal, H1) {
  if (signal === "HOLD") {
    return { status: "NO TRADE" };
  }

  const squeeze = H1.squeeze;

  if (
    !squeeze ||
    !Number.isFinite(squeeze.momentum) ||
    squeeze.state !== "SQUEEZE_RELEASED"
  ) {
    return { status: "WAIT" };
  }

  if (
    signal === "BUY" &&
    !squeeze.direction?.startsWith("BULLISH")
  ) {
    return { status: "WAIT" };
  }

  if (
    signal === "SELL" &&
    !squeeze.direction?.startsWith("BEARISH")
  ) {
    return { status: "WAIT" };
  }

  return { status: "H1 ALIGNED" };
}

function printTimeframe(name, result) {
  console.log(`\n${name} ANALYSIS`);
  console.log("-----------------------");
  console.log("Close:", result.close);
  console.log("EMA 20:", result.ema20);
  console.log("EMA 50:", result.ema50);
  console.log("RSI 14:", result.rsi14);
  console.log("MACD:", result.macd);
  console.log("MACD Signal:", result.macdSignal);
  console.log("ATR 14:", result.atr14);
  console.log("POC:", result.poc);
  console.log("Value Area High:", result.valueAreaHigh);
  console.log("Value Area Low:", result.valueAreaLow);
  console.log("BOS:", result.structure.bos);
  console.log("Liquidity Sweep:", result.structure.sweep);
  console.log("Squeeze:", result.squeeze.state);
  console.log("Squeeze Direction:", result.squeeze.direction);
  console.log("Bullish Votes:", result.bullishVotes);
  console.log("Bearish Votes:", result.bearishVotes);
}

async function main() {
  console.log("======================================");
  console.log("          BTCUSD SNIPER AI");
  console.log("     Multi-Timeframe Analysis");
  console.log("======================================");
  console.log("Live trading: DISABLED");

  const [m5, m15, h1] = await Promise.all([
    loadCandles("data/btcusd-m5.json", "M5", 5 * 60 * 1000),
    loadCandles("data/btcusd-m15.json", "M15", 15 * 60 * 1000),
    loadCandles("data/btcusd-h1.json", "H1", 60 * 60 * 1000)
  ]);

  const results = {
    M5: analyseTimeframe(m5),
    M15: analyseTimeframe(m15),
    H1: analyseTimeframe(h1)
  };

  printTimeframe("M5", results.M5);
  printTimeframe("M15", results.M15);
  printTimeframe("H1", results.H1);

  const signal = evaluateSignal(results);
  const confirmation = confirmSignal(signal, results.H1);
  const plan = tradePlan(signal, results.M5, confirmation);
  const action = finalAction(signal, plan);

  console.log("\n======================================");
  console.log("           FINAL BTCUSD SIGNAL");
  console.log("======================================");
  console.log("Candidate:", signal);
  console.log("Confirmation:", confirmation.status);
  console.log("FINAL ACTION:", action);

  if (plan) {
    console.log("ENTRY:", plan.entry.toFixed(2));
    console.log("STOP LOSS:", plan.stopLoss.toFixed(2));
    console.log("TAKE PROFIT:", plan.takeProfit.toFixed(2));
    console.log("RISK / REWARD:", plan.riskReward);
  } else {
    console.log("No confirmed trade. Waiting for confirmation.");
  }

  console.log("\nM5 candles:", m5.length);
  console.log("M15 candles:", m15.length);
  console.log("H1 candles:", h1.length);
  console.log("Paper analysis only — no orders sent.");
}

main().catch(error => {
  console.error("BTCUSD ANALYSIS ERROR:", error);
  process.exitCode = 1;
});
