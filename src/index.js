import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import { analyseTimeframe } from "./market.js";
import { buildIndicativeTradePlan, pricePlanAtExecutableQuote, finalAction } from "./trade-plan.js";
import { evaluateDeterministicFallback } from "./execution-policy.js";
import { evaluateSignal, confirmSignal, scoreInstitutionalSetup } from "./signal.js";
import { evaluateTieredSignal } from "./tiered-signal.js";
import { evaluateVWAPStrategies, selectVWAPConsensus, resolvePrimaryDirection } from "./vwap-strategies.js";
import { getForexNews } from "./news.js";
import { buildMacroContext } from "./macro.js";
import { getEconomicCalendar, evaluateEconomicRisk } from "./economic-calendar.js";
import { fetchBtcOptionsWalls, summarizeOptionsContext } from "./options-flow.js";
import { getGoldNewsWindow, evaluateGoldNewsCandle } from "./gold-news-strategy.js";
import { runTradingAgents, gateSignalWithAgents, evaluateAPlusFallback } from "./trading-agents.js";
import { runIndependentLlmAgents } from "./llm-agents.js";
import { getPolymarketBtcContext } from "./polymarket-quant.js";
import { updateSecondBrain } from "./second-brain.js";
import { getBtcLiveMicrostructure } from "./btc-live-microstructure.js";
import { fetchBidAskQuotes } from "./bid-ask-quotes.js";
import { createQuoteSnapshot } from "./quote-snapshot.js";
import { runMarketIntelligenceAgent } from "./market-intelligence-agent.js";
import { fetchPublicTraderEvidence } from "./public-trader-signals.js";
import { runSignalApprovalAgent } from "./signal-approval-agent.js";
import { runEntryVerificationAgent } from "./entry-verification-agent.js";
import { buildDiscoveryLayer, buildVerificationLayer, buildExecutionLayer } from "./decision-layers.js";
import { decideBrainAction } from "./brain-decision.js";
import { learnFromMarketData } from "./market-data-learning.js";
import { scoreCandidate } from "./weighted-score.js";
import { discoverSetups } from "./setup-discovery.js";
import { evaluateA1Heart } from "./a1-heart.js";

const DATA_DIR = process.env.DATA_DIR ?? "data";
const WINDOW = 240;
const MIN_HISTORY = 60;
const SIGNAL_PROFILE = (process.env.SIGNAL_PROFILE ?? "balanced").toLowerCase();
if (!["baseline", "strict", "advanced", "institutional", "gold", "balanced"].includes(SIGNAL_PROFILE)) {
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
    const raw = await readFile(`${DATA_DIR}/gold-live-ticks.jsonl`, "utf8");
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
  console.log("VOLUME PROFILE:", result.volumeProfileAvailable ? "AVAILABLE" : "UNAVAILABLE — no reported candle volume; POC/VAH/VAL suppressed");
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
    console.log("Gold bid/ask source: Biquote primary, Twelve Data fallback; validated immediately before the execution gate.");
  }

  const loadMarketFrames = async () => Promise.all(TIMEFRAMES.map(async tf => ({
    key: tf.key,
    candles: await loadCandles(`${DATA_DIR}/${market.symbol === "BTCUSD" ? (process.env.BTC_DATA_PREFIX ?? market.prefix) : market.prefix}-${tf.file}.json`, tf.key, tf.milliseconds)
  })));
  let frames = await loadMarketFrames();

  let staleTimeframes = TIMEFRAMES.filter(tf => {
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
    console.log("FAST RECOVERY: stale candles detected; refreshing provider history (maximum 2 attempts).");
    for (let attempt = 1; attempt <= 2 && staleTimeframes.length; attempt++) {
      try {
        const env = {
          ...process.env,
          MARKET_FILTER: market.symbol,
          DATA_DAYS_BACK: process.env.DATA_DAYS_BACK ?? "180"
        };
        const refreshed = await execFileAsync(process.execPath, ["src/download.js"], {
          cwd: process.cwd(), env, timeout: 90_000, maxBuffer: 10 * 1024 * 1024
        });
        console.log(`FAST RECOVERY ATTEMPT ${attempt}: candle refresh completed.`);
        if (refreshed.stdout) console.log(refreshed.stdout);
        if (refreshed.stderr) console.warn(refreshed.stderr);
        frames = await loadMarketFrames();
        staleTimeframes = TIMEFRAMES.filter(tf => {
          const candles = frames.find(frame => frame.key === tf.key).candles;
          const closedAt = candles.at(-1).timestamp + tf.milliseconds;
          return Date.now() - closedAt > tf.maxAgeMs;
        });
      } catch (error) {
        console.warn(`FAST RECOVERY ATTEMPT ${attempt} FAILED:`, error.message);
      }
    }
    if (staleTimeframes.length) {
      macroContext = { ...macroContext, dataStale: true, staleTimeframes: staleTimeframes.map(tf => tf.key) };
      console.log("DATA SAFETY GATE: HOLD — refresh did not restore fresh candles on", staleTimeframes.map(tf => tf.key).join(", "));
    } else {
      macroContext = { ...macroContext, dataStale: false, staleTimeframes: [] };
      console.log("DATA SAFETY GATE: RECOVERED — fresh candles reloaded; all downstream indicators and approval gates will be recomputed.");
    }
  }

  const results = Object.fromEntries(frames.map(({ key, candles }) =>
    [key, analyseTimeframe(candles)]
  ));

  // Learn market behaviour from refreshed provider candles, never from paper outcomes.
  const marketLearning = learnFromMarketData(
    frames.find(frame => frame.key === "M5").candles,
    { market: market.symbol }
  );
  console.log("MARKET-DATA LEARNING (REAL CANDLES ONLY):", JSON.stringify(marketLearning));

  // VWAP strategy panel is advisory-only. It cannot promote or veto the primary signal.
  const vwapReport = evaluateVWAPStrategies({
    candles: frames.find(frame => frame.key === "M5").candles,
    M5: results.M5, M15: results.M15, H1: results.H1, market: market.symbol
  });
  console.log("\\nFIVE-STRATEGY VWAP PANEL:", JSON.stringify(vwapReport));
  for (const setup of vwapReport.strategies) {
    console.log(`VWAP ${setup.name}: ${setup.signal} | ${setup.reason}`);
  }


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

  const candleHistory = Object.fromEntries(frames.map(({ key, candles }) => [key, candles]));
  const agentReport = runTradingAgents({ market: market.symbol, frames: results, macro: macroContext, candleHistory });
  console.log("\nQUANTITATIVE CANDLE FORECAST PANEL:", JSON.stringify(agentReport.forecastingAgents));
  console.log("QUANTITATIVE FORECAST SUMMARY:", JSON.stringify(agentReport.forecastingSummary));
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

  let marketReview = runMarketIntelligenceAgent({ market: market.symbol, frames: results, macro: macroContext });
  const calendarBlocked = market.symbol === "XAUUSD"
    ? marketReview.eventRisk?.blocksNewEntry ?? true
    : macroContext.eventRisk !== "NORMAL";
  const goldMacroBlocked = market.symbol === "XAUUSD" && calendarBlocked;
  console.log("AGENT 1 — MARKET INTELLIGENCE:", JSON.stringify(marketReview));
  // Directional bias is technical research only; it cannot authorize an order.
  const directionalContext = { ...macroContext, eventRisk: "NORMAL" };
  const directionalTieredReport = SIGNAL_PROFILE === "balanced" ? evaluateTieredSignal(results, directionalContext) : null;
  const legacyDirectionalBias = directionalTieredReport ? directionalTieredReport.signal : evaluateSignal(results, SIGNAL_PROFILE, directionalContext);
  const vwapDecision = selectVWAPConsensus(vwapReport);
  // The balanced tiered engine (or selected technical profile) discovers the
  // candidate. VWAP is independent confirmation/veto only, never a mandatory
  // entry ticket and never a source of a standalone trade.
  const directionalReview = resolvePrimaryDirection(legacyDirectionalBias, vwapDecision);
  const directionalBias = directionalReview.signal;
  const tieredReport = SIGNAL_PROFILE === "balanced" ? evaluateTieredSignal(results, macroContext) : null;
  console.log("PRIMARY SIGNAL PROVIDER:", SIGNAL_PROFILE === "balanced" ? "BALANCED TIERED TECHNICAL ENGINE" : `TECHNICAL PROFILE ${SIGNAL_PROFILE.toUpperCase()}`);
  console.log("VWAP CONSENSUS:", JSON.stringify(vwapDecision));
  console.log("VWAP DIRECTIONAL REVIEW:", directionalReview.reason);
  console.log("TECHNICAL CANDIDATE:", legacyDirectionalBias);
  console.log("DIRECTIONAL BIAS:", directionalBias, "| calendar:", macroContext.eventRisk, "| stale data:", Boolean(macroContext.dataStale));
  const setupDiscovery = discoverSetups(results);
  console.log("MULTI-PATTERN SETUP DISCOVERY:", JSON.stringify(setupDiscovery));
  let candidate = directionalBias === "HOLD" ? setupDiscovery.candidate : directionalBias;
  let aPlusFallback = null;
  if (candidate === "HOLD" && tieredReport && ["BUY", "SELL"].includes(tieredReport.signal)) {
    aPlusFallback = evaluateAPlusFallback(
      tieredReport.signal, tieredReport, legacyDirectionalBias, agentReport, macroContext
    );
    console.log("A+ INDEPENDENT CONFLUENCE FALLBACK:", JSON.stringify(aPlusFallback));
    if (aPlusFallback.approved) {
      candidate = tieredReport.signal;
      console.log("VWAP SILENT — A+ independent confluence fallback selected:", candidate);
    }
  }
  const directionalCandidate = candidate;
  const discoveryLayer = buildDiscoveryLayer({ market: market.symbol, candidate: directionalCandidate, frames: results, source: directionalBias === "HOLD" && setupDiscovery.candidate !== "HOLD" ? "multi-pattern-setup-discovery" : SIGNAL_PROFILE });
  console.log("LAYER 1 — SIGNAL DISCOVERY:", JSON.stringify(discoveryLayer));
  const executionBlockers = [];
  if (calendarBlocked || goldMacroBlocked || macroContext.dataStale) {
    const reason = macroContext.calendar?.risk?.reason ?? (macroContext.dataStale ? "Stale candle data." : "No verified event-risk clearance.");
    executionBlockers.push(reason);
    console.log("EXECUTION SAFETY GATE: BLOCKED —", macroContext.eventRisk, "|", reason);
  }
  if (market.symbol === "XAUUSD" && goldNewsWindow?.blockNewEntries) {
    executionBlockers.push("Scheduled high-impact gold news window");
    console.log("GOLD NEWS EVENT GATE: HOLD — scheduled high-impact release window; the candle setup is informational until broker spread and execution conditions can be verified.");
  }
  if (market.symbol === "XAUUSD" && goldMacroBlocked) {
    console.log("GOLD MACRO SAFETY GATE: HOLD — verified high-impact event risk is HIGH or the official calendar/news feed is UNKNOWN.");
  }
  const deterministicFallback = evaluateDeterministicFallback(
    directionalCandidate, market.symbol, results, macroContext,
    market.symbol === "XAUUSD" && goldNewsWindow?.blockNewEntries
      ? ["Scheduled high-impact gold news window"] : []
  );
  console.log("MARKET-SPECIFIC DETERMINISTIC FALLBACK:", JSON.stringify(deterministicFallback));
  const agentGate = aPlusFallback?.approved
    ? { signal: directionalCandidate, ...aPlusFallback }
    : gateSignalWithAgents(directionalCandidate, agentReport);
  console.log("MULTI-AGENT PORTFOLIO DECISION:", agentReport.portfolioManager.decision);
  console.log("MULTI-AGENT CONFIRMATION QUALITY:", JSON.stringify({ tier: agentGate.quality ?? "WEAK", approved: agentGate.approved ?? false, supporting: agentGate.supporting ?? 0, opposing: agentGate.opposing ?? 0, agreementPct: agentGate.agreementPct ?? 0, coreSupport: agentGate.coreSupport ?? 0, higherTimeframe: agentGate.higherTimeframe ?? "UNKNOWN", volatility: agentGate.volatility ?? "UNKNOWN", reasons: agentGate.reasons ?? [] }));
  console.log("MULTI-AGENT DIRECTIONAL REVIEW:", agentGate.reason);
  candidate = agentGate.signal;
  if (deterministicFallback.blockers?.length) {
    executionBlockers.push(...deterministicFallback.blockers);
    candidate = "HOLD";
  }
  if (candidate === "HOLD" && deterministicFallback.approved && executionBlockers.length === 0) {
    candidate = directionalCandidate;
    console.log("DETERMINISTIC FALLBACK: APPROVED — cloud agent availability and strict panel agreement are not required.");
  } else if (candidate === "HOLD" && directionalCandidate !== "HOLD") {
    executionBlockers.push(...(agentGate.reasons ?? [agentGate.reason ?? "Multi-agent confirmation not approved"]));
    if (!deterministicFallback.approved) executionBlockers.push(...deterministicFallback.reasons);
  }
  console.log("AGENT-REVIEWED EXECUTION CANDIDATE:", candidate);
  if (calendarBlocked || goldMacroBlocked || macroContext.dataStale || goldNewsWindow?.blockNewEntries) {
    console.log("EXECUTION CANDIDATE: HOLD — directional bias remains visible, but a mandatory safety gate is not clear.");
    candidate = "HOLD";
  } else {
    console.log("EXECUTION CANDIDATE (pre-Gemini):", candidate);
  }

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
  // The eleven local deterministic specialists are the fast primary decision path.
  // Gemini is an additional cloud review with a 5-second budget; only a complete,
  // schema-valid six-role response may veto. Timeout/error falls back to local agents.
  if (staleTimeframes.length) {
    candidate = "HOLD";
    console.log("HARD DATA SAFETY GATE: HOLD — stale candle data cannot be overridden by local agents or cloud review.");
  }

  if (llmReport.status === "COMPLETE" && candidate !== "HOLD") {
    const specialistVeto = (llmReport.agents ?? []).some(agent => agent.veto === true);
    const supportVotes = candidate === "BUY" ? llmReport.votes?.buy ?? 0 : llmReport.votes?.sell ?? 0;
    const opposingVotes = candidate === "BUY" ? llmReport.votes?.sell ?? 0 : llmReport.votes?.buy ?? 0;
    const llmConfirms = aPlusFallback?.approved
      ? !specialistVeto && supportVotes >= 2 && opposingVotes <= 1
      : llmReport.decision === candidate;
    if (!llmConfirms) {
      executionBlockers.push("Gemini completed but six-role consensus did not confirm " + candidate + " (BUY " + (llmReport.votes?.buy ?? 0) + ", SELL " + (llmReport.votes?.sell ?? 0) + ", veto " + specialistVeto + ")");
      console.log("GEMINI SIX-ROLE VETO: HOLD — independent review did not sufficiently confirm the candidate.");
      candidate = "HOLD";
    }
  } else if (["TIMEOUT", "ERROR", "NOT_CONFIGURED"].includes(llmReport.status)) {
    console.log("GEMINI REVIEW:", llmReport.status, "— deterministic local validation remains authoritative; cloud failure does not erase a valid candidate.");
  }

  // Coinbase 10-second spot tape is a final BTC entry-timing veto only.
  // It cannot create/promote a signal or replace the validated M5-H4 analysis.
  if (market.symbol === "BTCUSD") {
    const micro = await getBtcLiveMicrostructure();
    console.log("COINBASE BTC 10-SECOND MICROSTRUCTURE:", JSON.stringify({
      status: micro.status, direction: micro.direction, ageMs: micro.ageMs,
      netChange: micro.netChange, upCandles: micro.upCandles,
      downCandles: micro.downCandles, source: micro.source, reason: micro.reason
    }));
    if (candidate !== "HOLD" && micro.status !== "LIVE") {
      executionBlockers.push("BTC 10-second microstructure feed: " + (micro.reason ?? "not live"));
      console.log("BTC LIVE-FEED SAFETY GATE: HOLD —", micro.reason ?? "10-second feed is not live.");
      candidate = "HOLD";
    } else if (candidate !== "HOLD" && micro.direction !== "NEUTRAL" &&
               micro.direction !== candidate) {
      executionBlockers.push("BTC 10-second Coinbase tape opposes " + candidate);
      console.log("BTC MICROSTRUCTURE VETO: HOLD — 10-second Coinbase tape opposes", candidate);
      candidate = "HOLD";
    }
  }

  if (tieredReport) console.log("TIERED SETUP:", JSON.stringify(tieredReport));
  if (SIGNAL_PROFILE === "institutional") console.log("INSTITUTIONAL SCORE:", scoreInstitutionalSetup(results, macroContext));
  console.log("MACRO CONTEXT:", JSON.stringify(macroContext));
  console.log("AUTOMATIC ECONOMIC CALENDAR REFERENCE:",
    macroContext.calendar?.provider ?? "unknown",
    "| status:", macroContext.calendar?.status ?? "UNKNOWN",
    "| source:", macroContext.calendar?.sourceUrl ?? "unavailable",
    "| Forex Factory manual cross-check:", macroContext.calendarReference?.url ?? "unavailable");
  for (const event of macroContext.calendar?.risk?.nextEvents ?? []) {
    console.log("UPCOMING ECONOMIC EVENT:", event.name, "|", event.country, "|", event.impact,
      "|", event.scheduledAt ?? event.date ?? "time unknown",
      "| source:", event.sourceUrl ?? macroContext.calendar?.sourceUrl ?? "unavailable");
  }
  for (const event of macroContext.calendar?.risk?.activeEvents ?? []) {
    console.log("ACTIVE EVENT RISK:", event.name, "|", event.country, "|", event.impact,
      "|", event.scheduledAt ?? "time unknown",
      "| source:", event.sourceUrl ?? macroContext.calendar?.sourceUrl ?? "unavailable");
  }
  // H1 squeeze-release confirmation is a BTC-specific strategy rule. EUR/USD and
  // Gold use their own independent M15/H1/H4 + M5 trigger checks in the
  // market-intelligence agent; applying the BTC squeeze rule to them caused
  // unrelated FX/metals candidates to be rejected as "H1 not aligned".
  const confirmation = market.symbol === "BTCUSD"
    ? confirmSignal(directionalCandidate, results.H1)
    : { status: "H1 ALIGNED", reason: "BTC-only squeeze filter not applicable; market-specific higher-timeframe and M5 checks remain mandatory." };
  const candleClosePlan = buildIndicativeTradePlan(directionalCandidate, results.M5, market.symbol);
  // Fetch the active market's bid/ask immediately before final validation so
  // long-running agent reviews do not age the quote before the execution gate.
  const bidAskFeed = await fetchBidAskQuotes({ markets: [market.symbol] });
  const rawSpreadQuote = bidAskFeed.quotes[market.symbol] ?? null;
  const quoteSnapshot = createQuoteSnapshot(rawSpreadQuote, market.symbol);
  const spreadQuote = quoteSnapshot.quote;
  const quoteValidation = quoteSnapshot.validation;
  const plan = pricePlanAtExecutableQuote(
    candleClosePlan, directionalCandidate, spreadQuote, quoteValidation, results.M5.atr14
  );
  if (candleClosePlan && !plan) executionBlockers.push("No fresh validated executable-side quote could price the candidate plan");
  if (plan && !plan.entryTriggerConfirmed) executionBlockers.push("M5 trigger candle is not confirmed; quote-priced levels are indicative only");
  const spreadVerified = Boolean(quoteValidation.valid &&
    Number.isFinite(results.M5.atr14) && results.M5.atr14 > 0 &&
    quoteValidation.spread / results.M5.atr14 <=
      (market.symbol === "EURUSD" ? 0.12 : market.symbol === "BTCUSD" ? 0.18 : 0.15));
  console.log("BID/ASK PROVIDER STATUS:", JSON.stringify({
    status: bidAskFeed.status, provider: bidAskFeed.provider,
    errors: bidAskFeed.errors
  }));
  console.log("BID/ASK MARKET QUOTE:", JSON.stringify({
    market: market.symbol, symbol: spreadQuote?.symbol ?? null,
    bid: spreadQuote?.bid ?? null, ask: spreadQuote?.ask ?? null,
    spread: quoteValidation.spread ?? null,
    timestamp: spreadQuote?.timestamp ?? null, receivedAt: spreadQuote?.receivedAt ?? null,
    timestampQuality: spreadQuote?.timestampQuality ?? "PROVIDER_TIMESTAMP",
    source: spreadQuote?.source ?? "unavailable", venue: spreadQuote?.venue ?? "reference-only",
    validation: quoteValidation
  }));
  marketReview = runMarketIntelligenceAgent({ market: market.symbol, frames: results, macro: macroContext, quote: quoteValidation.valid ? { ...spreadQuote, spread: quoteValidation.spread } : null });
  const publicTraderEvidence = await fetchPublicTraderEvidence(market.symbol);
  console.log("PUBLIC TRADER IDEAS (ADVISORY ONLY):", JSON.stringify(publicTraderEvidence));
  const a1Heart = evaluateA1Heart({ candles: frames.find(frame => frame.key === "M5").candles, market: market.symbol });
  console.log("A1 HEART — MULTI-SESSION OPENING RANGE / VOLUME PROFILE / ABSORPTION:", JSON.stringify(a1Heart));
  console.log("A1 HEART SESSION STATUS:", (a1Heart.sessions ?? []).map(session => `${session.name}: ${session.status}`).join(" | "));
  const weightedScore = scoreCandidate({
    market: market.symbol,
    direction: directionalCandidate,
    frames: results,
    marketReview,
    quoteValidation,
    spreadVerified,
    macroBlocked: calendarBlocked || goldMacroBlocked || Boolean(macroContext.dataStale) || Boolean(goldNewsWindow?.blockNewEntries),
    staleTimeframes: staleTimeframes.map(tf => tf.key),
    a1Heart
  });
  console.log("WEIGHTED VERIFICATION SCORE:", JSON.stringify(weightedScore));

  // Publish the research candidate as soon as deterministic market scoring is
  // available. This is deliberately before independent approval agents and
  // never changes the candidate or relaxes any downstream hard gate.
  const latestClosedM5 = frames.find(frame => frame.key === "M5").candles.at(-1);
  const candidateSnapshot = {
    generatedAt: new Date().toISOString(),
    market: market.symbol,
    direction: directionalCandidate,
    score: weightedScore.score,
    coverage: weightedScore.coverage,
    scoreStatus: weightedScore.status,
    scoreType: "HEURISTIC_CANDIDATE_POINTS_NOT_PROBABILITY",
    closedM5At: new Date(latestClosedM5.timestamp + 5 * 60 * 1000).toISOString(),
    m5Close: results.M5.close,
    bid: spreadQuote?.bid ?? null,
    ask: spreadQuote?.ask ?? null,
    quoteSource: spreadQuote?.source ?? "unavailable",
    quoteValidation: quoteValidation.valid ? "VALID" : "INVALID_OR_UNAVAILABLE",
    hardBlockers: weightedScore.hardBlockers ?? [],
    approvalStatus: "PENDING_INDEPENDENT_VERIFICATION"
  };
  console.log("EARLY DIRECTIONAL CANDIDATE — RESEARCH ONLY:", JSON.stringify(candidateSnapshot));
  console.log("IMPORTANT: this candidate is not an approved trade. Layer 2 and Layer 3 remain mandatory.");

  // Agents and specialist vote counts are advisory. Restore the discovered
  // direction only when the weighted evidence passes and all hard safety gates clear.
  if (weightedScore.status === "ELIGIBLE_FOR_RISK_GATE") {
    candidate = directionalCandidate;
    console.log("WEIGHTED ENGINE: candidate advanced to deterministic risk approval.");
  } else {
    candidate = "HOLD";
    console.log("WEIGHTED ENGINE: candidate retained for research but not advanced:", weightedScore.status);
  }
  const spreadAtrRatio = Number.isFinite(results.M5.atr14) && results.M5.atr14 > 0 && Number.isFinite(quoteValidation.spread)
    ? quoteValidation.spread / results.M5.atr14 : null;
  console.log("MARKET SPREAD/ATR CHECK:", JSON.stringify({
    market: market.symbol, spread: quoteValidation.spread ?? null, m5Atr: results.M5.atr14 ?? null,
    ratio: spreadAtrRatio, limit: market.symbol === "EURUSD" ? 0.12 : market.symbol === "BTCUSD" ? 0.18 : 0.15,
    passed: spreadVerified
  }));
  console.log("AGENT 1 — BID/ASK + BUYER/SELLER REVIEW:", JSON.stringify({ direction: marketReview.direction, approved: marketReview.approved, spread: marketReview.spread ?? null, orderFlow: marketReview.orderFlow, blockers: marketReview.blockers, eventRisk: marketReview.eventRisk ?? null }));
  if (!spreadVerified) executionBlockers.push("No fresh, valid bid/ask quote within the market-specific spread/ATR limit");
  // Quote validation is not proof of the brokerage account or order route.
  // Keep finalAction closed until the actual execution venue is explicitly connected.
  executionBlockers.push("Execution venue/account is not connected and verified; market-data quotes alone cannot authorize an order");
  if (confirmation.status !== "H1 ALIGNED") executionBlockers.push(confirmation.reason ?? "H1 confirmation not aligned");
  if (!marketReview.approved) executionBlockers.push(...(marketReview.blockers ?? ["Market-intelligence agent rejected the setup"]));
  // Manual paper-signal approval must not depend on a broker account.
  // Broker connectivity is retained only as a separate execution-status blocker;
  // calendar, stale-data, spread and live-feed safety blockers still veto approval.
  const approvalBlockers = executionBlockers.filter(reason =>
    /calendar|economic|news window|stale|bid\/ask|spread|BTC 10-second|Coinbase/i.test(reason)
  );
  // Keep the immutable Layer 1 direction through independent approval.
  // The old flow replaced a valid BUY/SELL discovery with HOLD whenever the
  // weighted score was below threshold, then passed HOLD to both agents. This
  // generated misleading "No directional candidate" and direction-conflict
  // blockers instead of evaluating the actual candidate and its real failures.
  const approval = runSignalApprovalAgent({
    candidate: directionalCandidate, marketReview, plan, quoteValidation, quote: spreadQuote,
    dataStale: Boolean(macroContext.dataStale) || staleTimeframes.length > 0,
    entryAtr: results.M5.atr14,
    executionBlockers: approvalBlockers
  });
  console.log("AGENT 2 — INDEPENDENT SIGNAL APPROVAL:", JSON.stringify(approval));
  const verification = runEntryVerificationAgent({
    market: market.symbol, candidate: directionalCandidate, plan, quote: spreadQuote,
    quoteValidation, entryAtr: results.M5.atr14,
    marketReview, approval, dataStale: Boolean(macroContext.dataStale) || staleTimeframes.length > 0
  });
  console.log("AGENT 3 — INDEPENDENT LIVE ENTRY VERIFICATION:", JSON.stringify(verification));
  const verificationLayer = buildVerificationLayer({
    discovery: discoveryLayer, marketReview, deterministicFallback, agentGate, llmReport,
    staleTimeframes, macroBlocked: calendarBlocked || goldMacroBlocked || Boolean(macroContext.dataStale) || Boolean(goldNewsWindow?.blockNewEntries),
    spreadVerified, weightedScore
  });
  console.log("LAYER 2 — INDEPENDENT VERIFICATION:", JSON.stringify(verificationLayer));
  const executionLayer = buildExecutionLayer({
    discovery: discoveryLayer, verification: verificationLayer, plan, quote: spreadQuote,
    quoteValidation, approval, entryVerification: verification, executionVenueConnected: false
  });
  console.log("LAYER 3 — EXECUTION APPROVAL:", JSON.stringify(executionLayer));
  // One deterministic brain owns the final paper decision. No broker orders are possible.
  const brainDecision = decideBrainAction({
    market: market.symbol,
    candidate: directionalCandidate,
    weightedScore,
    verificationLayer,
    approval,
    entryVerification: verification,
    executionLayer,
    hardBlockers: approvalBlockers,
    calendarBlocked,
    macroBlocked: goldMacroBlocked,
    dataStale: Boolean(macroContext.dataStale) || staleTimeframes.length > 0,
    newsBlocked: Boolean(goldNewsWindow?.blockNewEntries),
    marketLearning
  });
  console.log("UNIFIED TRADING BRAIN — FINAL DECISION:", JSON.stringify(brainDecision));
  const riskClear = brainDecision.approved;
  const action = brainDecision.action;
  const signalGrade = action === "BUY" || action === "SELL" ? "A"
    : ["BUY", "SELL"].includes(directionalCandidate) ? "B" : "NO SETUP";
  const executionStatus = action === "BUY" || action === "SELL"
    ? "PAPER SIGNAL APPROVED — entry priced at validated " + plan.entryReference + "; broker routing remains disabled"
    : "NO APPROVED TRADE — one or more confirmation, data, spread or risk gates failed";

  try {
    const brain = await updateSecondBrain({
      market: market.symbol,
      candles: frames.find(frame => frame.key === "M5").candles,
      signal: action,
      candidate: directionalCandidate,
      plan,
      quote: spreadQuote,
      quoteValidation,
      vwap: { ...vwapDecision, strategies: vwapReport.strategies },
      agents: agentReport,
      llm: llmReport,
      macro: macroContext,
      frames: results,
      marketIntelligence: marketReview,
      decisionLayers: { discovery: discoveryLayer, weightedScore, verification: verificationLayer, execution: executionLayer },
      approval,
      verification,
      strategyAttribution: {
        profile: SIGNAL_PROFILE,
        strategyId: tieredReport?.setupType ?? "CORE_MULTI_TIMEFRAME",
        strategyName: tieredReport?.setupType ?? "Core multi-timeframe",
        setupTier: tieredReport?.tier ?? null,
        session: results.M5.sessionContext?.primary ?? "UNKNOWN",
        marketRegime: results.M5.regime ?? "UNKNOWN",
        weightedScore: weightedScore.score,
        scoreCoverage: weightedScore.coverage
      }
    });
    console.log("SECOND BRAIN MEMORY:", JSON.stringify(brain));
  } catch (error) {
    console.error("SECOND BRAIN STORAGE WARNING:", error.message);
  }

  console.log("\n======================================");
  console.log(`          FINAL ${market.symbol} SIGNAL`);
  console.log("======================================");
  console.log("ACTIVE PROFILE:", SIGNAL_PROFILE);
  if (tieredReport) console.log("SETUP TIER / TYPE:", tieredReport.tier, "/", tieredReport.setupType);
  console.log("LAYER 1 DISCOVERED CANDIDATE:", discoveryLayer.candidate);
  console.log("SIGNAL GRADE:", signalGrade, "| A=approved paper signal; B=directional research only, not approved; NO SETUP=no direction");
  console.log("CANDIDATE STRENGTH / EVIDENCE COVERAGE:", weightedScore.score + "/100" + " / " + weightedScore.coverage + "%");
  console.log("LAYER 2 VERIFICATION:", verificationLayer.status, "| blockers:", JSON.stringify(verificationLayer.blockers));
  console.log("LAYER 3 PAPER APPROVAL:", executionLayer.decision, "| approved:", executionLayer.paperApproved);
  console.log("BROKER EXECUTION STATUS:", executionLayer.brokerExecutionStatus, "| executable:", executionLayer.brokerExecutable);
  console.log("DIRECTIONAL CANDIDATE:", directionalCandidate);
  console.log("EXECUTION CANDIDATE:", candidate);
  console.log("CONFIRMATION:", confirmation.status);
  console.log("AGENT 1 MARKET REVIEW:", marketReview.approved ? "CONFIRMED" : "REJECTED");
  console.log("AGENT 2 FINAL REVIEW:", approval.decision, "| approved:", approval.approved);
  console.log("AGENT 3 ENTRY VERIFICATION:", verification.decision, "| approved:", verification.approved);
  if (!verification.approved) console.log("ENTRY VERIFICATION BLOCKERS:", JSON.stringify(verification.blockers));
  console.log("ENTRY STATUS:", plan?.status ?? "NO LEVELS — insufficient ATR/price data");
  console.log("EXECUTION STATUS:", executionStatus);
  console.log("REJECTION / UNVERIFIED CONDITIONS:", JSON.stringify([...new Set(executionBlockers)]));
  if (confirmation.reason) console.log("REASON:", confirmation.reason);
  console.log("FINAL ACTION:", action);

  if (plan) {
    console.log("ENTRY:", plan.entry.toFixed(market.symbol === "EURUSD" ? 5 : 2));
    console.log("ENTRY REFERENCE:", plan.entryReference, "(validated executable-side quote)");
    console.log("SIGNAL REFERENCE ENTRY:", plan.signalReferenceEntry.toFixed(market.symbol === "EURUSD" ? 5 : 2));
    console.log("M5 ENTRY TRIGGER CONFIRMED:", plan.entryTriggerConfirmed);
    console.log("STOP LOSS:", plan.stopLoss.toFixed(market.symbol === "EURUSD" ? 5 : 2));
    console.log("TAKE PROFIT:", plan.takeProfit.toFixed(market.symbol === "EURUSD" ? 5 : 2));
    console.log("RISK / REWARD:", plan.riskReward);
    console.log("RISK / REWARD VALUE:", plan.riskRewardValue);
    console.log("STOP METHOD:", plan.stopType);
  } else {
    console.log("No entry levels: directional candidate or valid ATR/close is unavailable.");
  }

  for (const { key, candles } of frames) console.log(`${key} closed candles:`, candles.length);
  console.log("Paper analysis only — no orders sent.");
}

async function main() {
  let articles = [];
  try {
    articles = await getForexNews();
  } catch (error) {
    console.error("Headline news unavailable:", error.message);
  }
  const economicCalendar = await getEconomicCalendar();
  console.log("ECONOMIC CALENDAR STATUS:", economicCalendar.status,
    "| provider:", economicCalendar.provider, "| events:", economicCalendar.count ?? 0,
    "| fetched:", economicCalendar.fetchedAt ?? "never", "| cache hit:", economicCalendar.cacheHit ?? false, "| cache age ms:", economicCalendar.cacheAgeMs ?? "n/a", "| error:", economicCalendar.error ?? "none");

  // Sequential market execution keeps asynchronous Gemini/news output grouped
  // under the correct instrument in the saved report.
  let failed = false;
  for (const market of MARKETS) {
    try {
      const marketNews = market.symbol === "XAUUSD" ? await (await import("./gold-news.js")).getGoldNews() : null;
      const selectedArticles = marketNews ?? articles;
      const marketRisk = evaluateEconomicRisk(economicCalendar, market.symbol);
      const calendarForMarket = { ...economicCalendar, marketRisk: { [market.symbol]: marketRisk } };
      let context = buildMacroContext(selectedArticles, Date.now(), calendarForMarket, market.symbol);
      if (market.symbol === "XAUUSD") {
        const goldMacro = await (await import("./gold-macro.js")).getGoldMacroData();
        const liveGoldContext = await loadGoldLiveContext();
        const yieldDate = Date.parse(goldMacro.yields?.latest?.date ?? "");
        const yieldAgeDays = Number.isFinite(yieldDate) ? Math.max(0, (Date.now() - yieldDate) / 86_400_000) : null;
        const freshYieldChange = yieldAgeDays !== null && yieldAgeDays <= 5 ? goldMacro.yields?.change10Y : null;
        const goldMacroBias = combineGoldMacroBias(freshYieldChange, liveGoldContext.dxyDirection);
        const headlineRisk = context.eventRisk ?? "UNKNOWN";
        const calendarRisk = goldMacro.eventRisk ?? "UNKNOWN";
        const combinedRisk = headlineRisk === "HIGH" || calendarRisk === "HIGH" || context.eventRisk === "HIGH" ? "HIGH"
          : context.eventRisk !== "NORMAL" ? context.eventRisk
            : calendarRisk === "HIGH" ? "HIGH" : "NORMAL";
        context = { ...context, goldMacro: goldMacro, goldMacroCalendar: goldMacro.calendar, liveGoldContext, goldMacroBias, eventRisk: combinedRisk, headlines: context.headlines ?? [] };
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
