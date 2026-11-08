import { readFile } from "node:fs/promises";
import { analyseTimeframe } from "./market.js";
import { tradePlan, finalAction } from "./trade-plan.js";
import { evaluateSignal, confirmSignal, scoreInstitutionalSetup } from "./signal.js";
import { getForexNews } from "./news.js";
import { buildMacroContext } from "./macro.js";
import { calculatePositionSize } from "./risk.js";
import { fetchBtcOptionsWalls, summarizeOptionsContext } from "./options-flow.js";

const WINDOW = 240;
const MIN_HISTORY = 60;
const SIGNAL_PROFILE = (process.env.SIGNAL_PROFILE ?? "baseline").toLowerCase();
if (!["baseline", "strict", "advanced", "institutional"].includes(SIGNAL_PROFILE)) {
  throw new Error("SIGNAL_PROFILE must be baseline, strict, advanced or institutional");
}

const MARKETS = [
  { symbol: "EURUSD", label: "EUR/USD", prefix: "eurusd", interval: 0.00001 },
  { symbol: "BTCUSD", label: "BTC/USD", prefix: "btcusd", interval: 0.01 }
];

const TIMEFRAMES = [
  { key: "M5", file: "m5", milliseconds: 5 * 60 * 1000 },
  { key: "M15", file: "m15", milliseconds: 15 * 60 * 1000 },
  { key: "H1", file: "h1", milliseconds: 60 * 60 * 1000 }
];

function getTime(candle) {
  const raw = candle.timestamp ?? candle.time ?? candle.date;
  const time = typeof raw === "number" ? raw : Date.parse(raw);
  if (!Number.isFinite(time)) return NaN;
  return time < 1e12 ? time * 1000 : time;
}

async function loadCandles(path, timeframe, interval) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`${path}: expected candle array`);

  const candles = raw.map(c => ({
    ...c,
    timestamp: getTime(c),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume ?? 0)
  })).filter(c =>
    Number.isFinite(c.timestamp) &&
    [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
    c.high >= Math.max(c.open, c.close, c.low) &&
    c.low <= Math.min(c.open, c.close, c.high) &&
    c.timestamp + interval <= Date.now()
  ).sort((a, b) => a.timestamp - b.timestamp);

  const unique = candles.filter((c, i) =>
    i === 0 || c.timestamp !== candles[i - 1].timestamp
  );

  if (unique.length < MIN_HISTORY) {
    throw new Error(`${timeframe}: only ${unique.length} valid closed candles; need ${MIN_HISTORY}`);
  }
  return unique.slice(-WINDOW);
}

function printTimeframe(name, result) {
  console.log(`\n${name} ANALYSIS`);
  console.log("-----------------------");
  console.log("Close:", result.close);
  console.log("Trading session:", result.sessionContext?.primary, "| Active:", (result.sessionContext?.active ?? []).join(", ") || "None");
  console.log("Session range high / low:", result.sessionContext?.rangeHigh, "/", result.sessionContext?.rangeLow);
  console.log("Session range breakout:", result.sessionContext?.breakout ?? "NONE");
  console.log("EMA 20 / 50:", result.ema20, "/", result.ema50);
  console.log("RSI 14:", result.rsi14);
  console.log("MACD / Signal:", result.macd, "/", result.macdSignal);
  console.log("ATR 14:", result.atr14);
  console.log("ADX 14:", result.adx14);
  console.log("VWAP 24:", result.vwap);
  console.log("CVD pressure proxy:", result.cvd.direction, "slope:", result.cvd.slope);
  console.log("POC / VAH / VAL:", result.poc, "/", result.valueAreaHigh, "/", result.valueAreaLow);
  console.log("BOS / Sweep:", result.structure.bos, "/", result.structure.sweep);
  console.log("Recent OB zones:", JSON.stringify(result.smartMoney.orderBlocks));
  console.log("Recent unfilled FVG zones:", JSON.stringify(result.smartMoney.fairValueGaps));
  console.log("H1 squeeze:", result.squeeze.state, result.squeeze.direction);
  console.log("Bullish / Bearish votes:", result.bullishVotes, "/", result.bearishVotes);
}

async function analyseMarket(market, macroContext) {
  console.log("\n======================================");
  console.log(`       ${market.label} SNIPER AI`);
  console.log("     Multi-Timeframe Analysis");
  console.log("======================================");
  console.log("Live trading: DISABLED");
  console.log("DATA MODE: scheduled historical snapshot; not a persistent Vantage stream.");
  if (market.symbol === "BTCUSD") console.log("BTC data prefix:", process.env.BTC_DATA_PREFIX ?? market.prefix, "| Set BTC_DATA_PREFIX=btcusdt to use the Binance spot feed (USDT proxy, not Vantage BTCUSD).");

  const frames = await Promise.all(TIMEFRAMES.map(async tf => ({
    key: tf.key,
    candles: await loadCandles(`data/${market.symbol === "BTCUSD" ? (process.env.BTC_DATA_PREFIX ?? market.prefix) : market.prefix}-${tf.file}.json`, tf.key, tf.milliseconds)
  })));

  const results = Object.fromEntries(frames.map(({ key, candles }) =>
    [key, analyseTimeframe(candles)]
  ));

  for (const tf of TIMEFRAMES) printTimeframe(tf.key, results[tf.key]);

  // BTC options positioning is supplemental context only; spot FX has no equivalent
  // consolidated listed-options feed in this free data setup.
  if (market.symbol === "BTCUSD") {
    try {
      const options = await fetchBtcOptionsWalls();
      const context = summarizeOptionsContext(options, results.M5.close);
      console.log("\nQUANT OPTIONS WALLS (BTC — nearest expiry)");
      console.log("Expiry / days:", options.expiry, "/", options.daysToExpiry.toFixed(2));
      console.log("Spot reference:", options.spot);
      console.log("Call wall (OI):", options.callWall);
      console.log("Put wall (OI):", options.putWall);
      console.log("Highest options volume strike:", options.volumeWall);
      console.log("OI-weighted IV concentration:", options.ivConcentration);
      console.log("Max pain:", options.maxPain);
      console.log("Gross gamma exposure proxy (unsigned):", options.grossGammaExposureProxy);
      console.log("Price vs walls:", context.bias);
      for (const note of options.dataNotes) console.log("OPTIONS DATA NOTE:", note);
    } catch (error) {
      console.log("\nQUANT OPTIONS WALLS: UNAVAILABLE —", error.message);
      console.log("Options data unavailable; normal spot analysis continues.");
    }
  }

  const candidate = evaluateSignal(results, SIGNAL_PROFILE, macroContext);
  if (SIGNAL_PROFILE === "institutional") console.log("INSTITUTIONAL SCORE:", scoreInstitutionalSetup(results, macroContext));
  console.log("MACRO CONTEXT:", JSON.stringify(macroContext));
  const confirmation = confirmSignal(candidate, results.H1);
  const plan = tradePlan(candidate, results.M5, confirmation);
  const action = finalAction(candidate, plan);

  console.log("\n======================================");
  console.log(`          FINAL ${market.symbol} SIGNAL`);
  console.log("======================================");
  console.log("ACTIVE PROFILE:", SIGNAL_PROFILE);
  console.log("CANDIDATE:", candidate);
  console.log("CONFIRMATION:", confirmation.status);
  if (confirmation.reason) console.log("REASON:", confirmation.reason);
  console.log("FINAL ACTION:", action);

  if (plan) {
    console.log("ENTRY:", plan.entry.toFixed(market.symbol === "EURUSD" ? 5 : 2));
    console.log("STOP LOSS:", plan.stopLoss.toFixed(market.symbol === "EURUSD" ? 5 : 2));
    console.log("TAKE PROFIT:", plan.takeProfit.toFixed(market.symbol === "EURUSD" ? 5 : 2));
    console.log("RISK / REWARD:", plan.riskReward);
    console.log("STOP METHOD:", plan.stopType);
    const balance = Number(process.env.ACCOUNT_BALANCE_USD);
    const riskPercent = Number(process.env.RISK_PERCENT ?? 1);
    const sizing = calculatePositionSize({ balance, riskPercent, entry: plan.entry, stopLoss: plan.stopLoss });
    if (sizing) {
      console.log("POSITION SIZE (units; USD-quoted approximation):", sizing.units);
      console.log("MAX ACCOUNT RISK (USD):", sizing.riskAmountUsd);
    } else {
      console.log("POSITION SIZE: not calculated; set ACCOUNT_BALANCE_USD (and optionally RISK_PERCENT).");
    }
  } else {
    console.log("No confirmed trade. Wait for a valid setup.");
  }

  for (const { key, candles } of frames) console.log(`${key} closed candles:`, candles.length);
  console.log("Paper analysis only — no orders sent.");
}

async function main() {
  let macroContext;
  try {
    const articles = await getForexNews();
    macroContext = buildMacroContext(articles);
  } catch (error) {
    macroContext = buildMacroContext([]);
    console.error("Macro news unavailable:", error.message);
  }
  const outcomes = await Promise.allSettled(MARKETS.map(market => analyseMarket(market, macroContext)));
  let failed = false;
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "rejected") {
      failed = true;
      console.error(`\n${MARKETS[index].label} ANALYSIS ERROR:`, outcome.reason);
    }
  });
  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error("FOREX SNIPER ERROR:", error);
  process.exitCode = 1;
});
