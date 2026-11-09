import { readFile } from "node:fs/promises";
import { analyseTimeframe } from "./market.js";
import { tradePlan, finalAction } from "./trade-plan.js";
import { evaluateSignal, confirmSignal, scoreInstitutionalSetup } from "./signal.js";
import { getForexNews } from "./news.js";
import { buildMacroContext } from "./macro.js";
import { fetchBtcOptionsWalls, summarizeOptionsContext } from "./options-flow.js";
import { getGoldNewsWindow, evaluateGoldNewsCandle } from "./gold-news-strategy.js";
import { runTradingAgents, gateSignalWithAgents } from "./trading-agents.js";
import { runIndependentLlmAgents } from "./llm-agents.js";
import { getPolymarketBtcContext } from "./polymarket-quant.js";

const WINDOW = 240;
const MIN_HISTORY = 60;
const SIGNAL_PROFILE = (process.env.SIGNAL_PROFILE ?? "baseline").toLowerCase();
if (!["baseline", "strict", "advanced", "institutional", "gold"].includes(SIGNAL_PROFILE)) {
  throw new Error("SIGNAL_PROFILE must be baseline, strict, advanced, institutional or gold");
}

const ALL_MARKETS = [
  { symbol: "EURUSD", label: "EUR/USD", prefix: "eurusd", interval: 0.00001 },
  { symbol: "BTCUSD", label: "BTC/USD", prefix: "btcusd", interval: 0.01 },
  { symbol: "XAUUSD", label: "XAU/USD (Gold)", prefix: "xauusd", interval: 0.01 }
];
const MARKET_FILTER = process.env.MARKET_FILTER?.toUpperCase();
const MARKETS = MARKET_FILTER ? ALL_MARKETS.filter(market => market.symbol === MARKET_FILTER) : ALL_MARKETS;
if (MARKET_FILTER && MARKETS.length === 0) throw new Error("Unknown MARKET_FILTER: " + MARKET_FILTER);

const TIMEFRAMES = [
  { key: "M5", file: "m5", milliseconds: 5 * 60 * 1000, maxAgeMs: 10 * 60 * 1000 },
  { key: "M15", file: "m15", milliseconds: 15 * 60 * 1000, maxAgeMs: 30 * 60 * 1000 },
  { key: "H1", file: "h1", milliseconds: 60 * 60 * 1000, maxAgeMs: 2 * 60 * 60 * 1000 },
  { key: "H4", file: "h4", milliseconds: 4 * 60 * 60 * 1000, maxAgeMs: 8 * 60 * 60 * 1000 }
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

async function loadGoldLiveContext() {
  try {
    const raw = await readFile("data/gold-live-ticks.jsonl", "utf8");
    const ticks = raw.trim().split("\n").slice(-500).map(line => JSON.parse(line))
      .filter(tick => tick.symbol === "DXY" && Number.isFinite(tick.timestamp) && Number.isFinite(tick.price))
      .sort((a, b) => a.timestamp - b.timestamp);
    if (ticks.length < 2) return { dxyDirection: "UNAVAILABLE", dxyChangePct: null };
    const latest = ticks.at(-1);
    if (Date.now() - latest.timestamp > 120_000) return { dxyDirection: "UNAVAILABLE", dxyChangePct: null, dxyStale: true };
    const base = [...ticks].reverse().find(tick => latest.timestamp - tick.timestamp >= 15 * 60 * 1000) || ticks[0];
    const changePct = base.price > 0 ? (latest.price / base.price - 1) * 100 : null;
    const direction = Number.isFinite(changePct) && changePct >= 0.05 ? "BEARISH"
      : Number.isFinite(changePct) && changePct <= -0.05 ? "BULLISH" : "NEUTRAL";
    return { dxyDirection: direction, dxyChangePct: changePct, dxyTimestamp: latest.timestamp, dxyPrice: latest.price };
  } catch {
    return { dxyDirection: "UNAVAILABLE", dxyChangePct: null };
  }
}

function combineGoldMacroBias(yieldChange, dxyDirection) {
  const yieldDirection = Number.isFinite(yieldChange) && yieldChange >= 0.02 ? "BEARISH"
    : Number.isFinite(yieldChange) && yieldChange <= -0.02 ? "BULLISH" : "NEUTRAL";
  const known = [yieldDirection, dxyDirection].filter(direction => ["BULLISH", "BEARISH"].includes(direction));
  if (!known.length) return "UNAVAILABLE";
  if (known.length === 2 && known[0] !== known[1]) return "NEUTRAL";
  return known[0];
}


function printTimeframe(name, result) {
  console.log(`
${name} ANALYSIS`);
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
  console.log("Supertrend:", result.supertrend.direction, result.supertrend.value);
  console.log("Ichimoku:", result.ichimoku.direction, "Tenkan/Kijun:", result.ichimoku.tenkan, "/", result.ichimoku.kijun);
  console.log("MFI 14 (tick-volume proxy):", result.mfi14);
  console.log("CCI 20:", result.cci20);
  console.log("Stochastic RSI K/D:", result.stochRsi.k, "/", result.stochRsi.d, "|", result.stochRsi.state, result.stochRsi.direction);
  console.log("Parabolic SAR:", result.psar.direction, result.psar.value, "| Reversal:", result.psar.reversal);
  console.log("Donchian 20:", result.donchian.lower, "/", result.donchian.upper, "| Breakout:", result.donchian.breakout);
  console.log("OBV:", result.obv.direction, "| slope:", result.obv.slope, "(tick-volume proxy)");
  console.log("Williams %R 14:", result.williamsR.value, "|", result.williamsR.state, result.williamsR.direction);
  console.log("Keltner 20/2:", result.keltner.lower, "/", result.keltner.middle, "/", result.keltner.upper, "| Breakout:", result.keltner.breakout);
  console.log("Aroon 25 Up/Down:", result.aroon.up, "/", result.aroon.down, "|", result.aroon.direction);
  console.log("ROC 12:", result.roc.value, "|", result.roc.direction);
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
  if (market.symbol === "BTCUSD") console.log("BTC data prefix:", process.env.BTC_DATA_PREFIX ?? market.prefix, "| Set BTC_DATA_PREFIX=kraken-btcusd to use Kraken XBT/USD spot candles (venue reference, not Vantage BTCUSD CFD).");
  if (market.symbol === "XAUUSD") {
    try {
      const quotes = JSON.parse(await readFile("data/gold-live-quotes.json", "utf8"));
      for (const symbol of ["XAU/USD", "DXY"]) {
        const quote = quotes[symbol.toUpperCase()];
        if (!quote) { console.log("GOLD REFERENCE QUOTE", symbol, ": unavailable"); continue; }
        const ageSeconds = Math.max(0, (Date.now() - Number(quote.receivedAt)) / 1000);
        console.log("GOLD REFERENCE QUOTE", symbol, ":", quote.price, "| bid/ask:", quote.bid, "/", quote.ask, "| age seconds:", ageSeconds.toFixed(0), "| source:", quote.source);
        if (ageSeconds > 120) console.log("STALE REFERENCE QUOTE:", symbol, "— do not use as a live entry price.");
      }
    } catch {
      console.log("GOLD REFERENCE QUOTES: unavailable — optional Twelve Data WebSocket feed is not running or has not saved a tick.");
    }
  }

  const frames = await Promise.all(TIMEFRAMES.map(async tf => ({
    key: tf.key,
    candles: await loadCandles(`data/${market.symbol === "BTCUSD" ? (process.env.BTC_DATA_PREFIX ?? market.prefix) : market.prefix}-${tf.file}.json`, tf.key, tf.milliseconds)
  })));

  const staleTimeframes = TIMEFRAMES.filter(tf => {
    const candles = frames.find(frame => frame.key === tf.key).candles;
    const closedAt = candles.at(-1).timestamp + tf.milliseconds;
    return Date.now() - closedAt > tf.maxAgeMs;
  });
  for (const tf of TIMEFRAMES) {
    const candles = frames.find(frame => frame.key === tf.key).candles;
    const closedAt = candles.at(-1).timestamp + tf.milliseconds;
    const ageMinutes = Math.max(0, (Date.now() - closedAt) / 60_000);
    console.log(`DATA FRESHNESS ${tf.key}:`, new Date(closedAt).toISOString(),
      `| age minutes: ${ageMinutes.toFixed(1)} | status: ${staleTimeframes.includes(tf) ? "STALE" : "FRESH"}`);
  }
  if (staleTimeframes.length) {
    macroContext = { ...macroContext, dataStale: true, staleTimeframes: staleTimeframes.map(tf => tf.key) };
    console.log("DATA SAFETY GATE: HOLD — stale candle data on", staleTimeframes.map(tf => tf.key).join(", "));
  }

  const results = Object.fromEntries(frames.map(({ key, candles }) =>
    [key, analyseTimeframe(candles)]
  ));

  let goldNewsWindow = null;
  if (market.symbol === "XAUUSD") {
    goldNewsWindow = getGoldNewsWindow(macroContext.calendar?.events ?? [], Date.now());
    console.log("GOLD NEWS-CANDLE WINDOW:", JSON.stringify(goldNewsWindow));
    if (goldNewsWindow.phase === "POST_RELEASE_CONFIRMATION" && goldNewsWindow.event) {
      const m5Candles = frames.find(frame => frame.key === "M5").candles;
      const setup = evaluateGoldNewsCandle(m5Candles, goldNewsWindow.event, Date.now());
      console.log("GOLD NEWS-CANDLE SETUP:", JSON.stringify(setup));
      if (setup.signal !== "HOLD") {
        console.log("NEWS CANDLE SAFETY: candidate only. Vantage-specific spread and slippage are not connected; do not treat this as an executable order.");
      }
    }
  }

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

  const agentReport = runTradingAgents({ market: market.symbol, frames: results, macro: macroContext });
  console.log("\nTRADINGAGENTS MULTI-AGENT REPORT:", JSON.stringify(agentReport));
  let polymarketContext = null;
  if (market.symbol === "BTCUSD") {
    try {
      polymarketContext = await getPolymarketBtcContext();
      console.log("POLYMARKET BTC EXPIRY CONTEXT:", JSON.stringify(polymarketContext));
    } catch (error) {
      polymarketContext = { status: "UNAVAILABLE", error: error.message };
      console.log("POLYMARKET BTC CONTEXT UNAVAILABLE:", error.message);
    }
  }

  const goldMacroBlocked = market.symbol === "XAUUSD" && macroContext.eventRisk !== "NORMAL";
  let candidate = goldMacroBlocked || macroContext.dataStale ? "HOLD" : evaluateSignal(results, SIGNAL_PROFILE, macroContext);
  if (market.symbol === "XAUUSD" && goldNewsWindow?.blockNewEntries) {
    console.log("GOLD NEWS EVENT GATE: HOLD — scheduled high-impact release window; the candle setup is informational until broker spread and execution conditions can be verified.");
  }
  if (market.symbol === "XAUUSD" && goldMacroBlocked) {
    console.log("GOLD MACRO SAFETY GATE: HOLD — verified high-impact event risk is HIGH or the official calendar/news feed is UNKNOWN.");
  }
  const agentGate = gateSignalWithAgents(candidate, agentReport);
  console.log("MULTI-AGENT PORTFOLIO DECISION:", agentReport.portfolioManager.decision);
  console.log("MULTI-AGENT GATE:", agentGate.reason);
  candidate = agentGate.signal;
  console.log("LOCAL SIGNAL PREVIEW (before Gemini review):", candidate, "| local portfolio:", agentReport.portfolioManager.decision);

  // Always request the six-role Gemini review, including when the local engine
  // says HOLD. This makes the six specialist assessments visible on every market
  // snapshot. Gemini remains confirmation/veto-only: it can never promote HOLD
  // into a trade or override local data-quality and risk gates.
  const llmReviewPromise = runIndependentLlmAgents({
    market: market.symbol,
    frames: results,
    macro: macroContext,
    polymarket: polymarketContext,
    deterministicAgents: agentReport
  });
  const llmReport = await llmReviewPromise;
  console.log("INDEPENDENT LLM AGENT REPORT:", JSON.stringify(llmReport));
  // The five local deterministic specialists are the fast primary decision path.
  // Gemini is an additional cloud review with a 5-second budget; only a complete,
  // schema-valid six-role response may veto. Timeout/error falls back to local agents.
  if (staleTimeframes.length) {
    candidate = "HOLD";
    console.log("HARD DATA SAFETY GATE: HOLD — stale candle data cannot be overridden by local agents or cloud review.");
  }

  if (llmReport.status === "COMPLETE" && candidate !== "HOLD" && llmReport.decision !== candidate) {
    console.log("GEMINI SIX-ROLE VETO: HOLD — completed Gemini panel did not confirm the local multi-agent candidate.");
    candidate = "HOLD";
  } else if (llmReport.status === "TIMEOUT" || llmReport.status === "ERROR") {
    console.log("GEMINI REVIEW:", llmReport.status, "— continuing with the local five-specialist decision; cloud review did not complete within its timeout budget.");
  }

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
  // Sequential market execution keeps asynchronous Gemini/news output grouped
  // under the correct instrument in the saved report.
  let failed = false;
  for (const market of MARKETS) {
    try {
      const marketNews = market.symbol === "XAUUSD" ? await (await import("./gold-news.js")).getGoldNews() : null;
      let context = marketNews ? buildMacroContext(marketNews) : macroContext;
      if (market.symbol === "XAUUSD") {
        const goldMacro = await (await import("./gold-macro.js")).getGoldMacroData();
        const liveGoldContext = await loadGoldLiveContext();
        const yieldDate = Date.parse(goldMacro.yields?.latest?.date ?? "");
        const yieldAgeDays = Number.isFinite(yieldDate) ? Math.max(0, (Date.now() - yieldDate) / 86_400_000) : null;
        const freshYieldChange = yieldAgeDays !== null && yieldAgeDays <= 5 ? goldMacro.yields?.change10Y : null;
        const goldMacroBias = combineGoldMacroBias(freshYieldChange, liveGoldContext.dxyDirection);
        const headlineRisk = context.eventRisk ?? "UNKNOWN";
        const calendarRisk = goldMacro.eventRisk ?? "UNKNOWN";
        const combinedRisk = headlineRisk === "HIGH" || calendarRisk === "HIGH" ? "HIGH"
          : calendarRisk === "UNKNOWN" ? "UNKNOWN" : "NORMAL";
        context = { ...context, ...goldMacro, liveGoldContext, goldMacroBias, eventRisk: combinedRisk, headlines: context.headlines ?? [] };
        console.log("GOLD MACRO DATA:", JSON.stringify(goldMacro));
        console.log("GOLD MACRO BIAS:", goldMacroBias, "| Real-yield change (10Y):", goldMacro.yields?.change10Y, "| Real-yield age days:", yieldAgeDays, "| DXY 15m change %:", liveGoldContext.dxyChangePct);
      }
      if (market.symbol === "XAUUSD") console.log("GOLD NEWS CONTEXT:", JSON.stringify(context));
      await analyseMarket(market, context);
    } catch (error) {
      failed = true;
      console.error(`\n${market.label} ANALYSIS ERROR:`, error);
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error("FOREX SNIPER ERROR:", error);
  process.exitCode = 1;
});
