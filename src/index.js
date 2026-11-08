
import { readFile, writeFile } from "node:fs/promises";
import { analyseTimeframe } from "./market.js";
import { tradePlan, finalAction } from "./trade-plan.js";
import { evaluateSignal, confirmSignal } from "./signal.js";
import { analyseDonchian, evaluateDonchianSignal } from "./donchian-strategy.js";
import { evaluateCombinedSignal } from "./combined-signal.js";

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

  return candles.slice(-300);
}


function printTimeframe(name, result) {
  console.log(`\n${name} ANALYSIS`);
  console.log("-----------------------");
  console.log("Close:", result.close);
  console.log("EMA 20:", result.ema20);
  console.log("EMA 50:", result.ema50);
  console.log("EMA 200:", result.ema200);
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

  const legacySignal = evaluateSignal(results);
  console.log("\nCOMBINED EVIDENCE SCORES:", combined.scores);
  console.log("LEGACY SIGNAL:", legacySignal);
  console.log("DONCHIAN SIGNAL:", donchianSignal);
  console.log("COMBINED REASONS:", combined.reasons);
  console.log("BULLISH EVIDENCE:", combined.bullishEvidence);
  console.log("BEARISH EVIDENCE:", combined.bearishEvidence);
  console.log("BLOCKERS:", combined.blockers);
  console.log("DATA SOURCE: Dukascopy historical rates; compare with Vantage app quote.");
  console.log("Paper analysis only — no orders sent.");

}

main().catch(error => {
  console.error("BTCUSD ANALYSIS ERROR:", error);
  process.exitCode = 1;
});
