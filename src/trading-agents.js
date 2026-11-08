// TradingAgents-inspired deterministic multi-agent decision layer.
// This is an original JavaScript implementation of the analyst/debate/trader/risk
// workflow; it does not import TauricResearch source code or require paid LLM APIs.

const directions = ["BUY", "SELL", "HOLD"];
const asDirection = value => value === "BULLISH" ? "BUY" : value === "BEARISH" ? "SELL" : "HOLD";

function vote(name, direction, weight, evidence) {
  return { name, direction: directions.includes(direction) ? direction : "HOLD", weight, evidence };
}

export function runTradingAgents({ market, frames, macro = {} }) {
  const { M5 = {}, M15 = {}, H1 = {} } = frames ?? {};
  const agents = [];

  // Technical analyst: trend alignment across execution and higher timeframes.
  const trendVotes = [M5, M15, H1].map(frame =>
    frame.regime === "BULL_TREND" ? 1 : frame.regime === "BEAR_TREND" ? -1 : 0);
  const trendSum = trendVotes.reduce((sum, value) => sum + value, 0);
  agents.push(vote("Technical analyst", trendSum >= 2 ? "BUY" : trendSum <= -2 ? "SELL" : "HOLD", 2,
    `M5/M15/H1 trend regime: ${trendVotes.join("/")}`));

  // Momentum analyst: require multiple independent momentum measures.
  const momentum = [
    M5.macdHistogram > 0 ? 1 : M5.macdHistogram < 0 ? -1 : 0,
    M15.macdHistogram > 0 ? 1 : M15.macdHistogram < 0 ? -1 : 0,
    M5.rsi14 >= 52 && M5.rsi14 <= 72 ? 1 : M5.rsi14 <= 48 && M5.rsi14 >= 28 ? -1 : 0,
    M5.supertrend?.direction === "BULLISH" ? 1 : M5.supertrend?.direction === "BEARISH" ? -1 : 0
  ];
  const momentumSum = momentum.reduce((sum, value) => sum + value, 0);
  agents.push(vote("Momentum analyst", momentumSum >= 2 ? "BUY" : momentumSum <= -2 ? "SELL" : "HOLD", 1.5,
    "MACD M5/M15, RSI and Supertrend"));

  // Market-structure analyst: BOS, liquidity sweep and OB/FVG retest.
  const structureSignals = [M5.structure?.bos, M5.structure?.sweep]
    .map(value => value === "BULLISH" ? 1 : value === "BEARISH" ? -1 : 0);
  const bullishZones = (M5.smartMoney?.orderBlocks ?? []).some(z => z.direction === "BULLISH" && !z.invalidated);
  const bearishZones = (M5.smartMoney?.orderBlocks ?? []).some(z => z.direction === "BEARISH" && !z.invalidated);
  structureSignals.push(bullishZones && !bearishZones ? 1 : bearishZones && !bullishZones ? -1 : 0);
  const structureSum = structureSignals.reduce((sum, value) => sum + value, 0);
  agents.push(vote("SMC and liquidity analyst", structureSum >= 1 ? "BUY" : structureSum <= -1 ? "SELL" : "HOLD", 1.5,
    "BOS, liquidity sweep and active order-block context"));

  // Macro/news analyst deliberately does not infer direction from headlines alone.
  const macroBias = macro.goldMacroBias === "BULLISH" ? "BUY"
    : macro.goldMacroBias === "BEARISH" ? "SELL" : "HOLD";
  agents.push(vote("Macro and news analyst", macroBias, 1,
    `Event risk: ${macro.eventRisk ?? "UNKNOWN"}; directional bias: ${macro.goldMacroBias ?? "UNCONFIRMED"}`));

  // Volume/auction analyst: use price relative to value area and VWAP where available.
  const valueSignals = [
    Number.isFinite(M5.vwap) ? (M5.close > M5.vwap ? 1 : M5.close < M5.vwap ? -1 : 0) : 0,
    Number.isFinite(M5.poc) ? (M5.close > M5.poc ? 1 : M5.close < M5.poc ? -1 : 0) : 0,
    M5.cvd?.direction === "BUYING" ? 1 : M5.cvd?.direction === "SELLING" ? -1 : 0
  ];
  const valueSum = valueSignals.reduce((sum, value) => sum + value, 0);
  agents.push(vote("Volume and auction analyst", valueSum >= 2 ? "BUY" : valueSum <= -2 ? "SELL" : "HOLD", 1,
    "VWAP, volume-profile POC and cumulative-volume pressure proxy"));

  const score = direction => agents.reduce((sum, agent) =>
    sum + (agent.direction === direction ? agent.weight : 0), 0);
  const bullScore = score("BUY");
  const bearScore = score("SELL");
  const totalDirectionalWeight = agents.reduce((sum, agent) => sum + agent.weight, 0);
  const strongest = Math.max(bullScore, bearScore);
  const rawBias = bullScore > bearScore ? "BUY" : bearScore > bullScore ? "SELL" : "HOLD";
  const confidence = totalDirectionalWeight ? Math.round(100 * strongest / totalDirectionalWeight) : 0;

  // Bull/bear research debate: the opposing team is explicitly surfaced.
  const bullCase = agents.filter(agent => agent.direction === "BUY").map(agent => agent.name);
  const bearCase = agents.filter(agent => agent.direction === "SELL").map(agent => agent.name);
  const debateGap = Math.abs(bullScore - bearScore);

  // Risk manager: no trade through known high-impact events or abnormal volatility.
  const atr = M5.atr14;
  const atrBase = M5.atrBaseline;
  const volatilityExtreme = Number.isFinite(atr) && Number.isFinite(atrBase) && atrBase > 0 && atr / atrBase > 2.5;
  const riskBlocks = [];
  if (macro.eventRisk === "HIGH") riskBlocks.push("HIGH_IMPACT_NEWS");
  if (macro.dataStale === true) riskBlocks.push("STALE_MARKET_DATA");
  if (volatilityExtreme) riskBlocks.push("ABNORMAL_VOLATILITY");
  if (!frames?.M5 || !frames?.M15 || !frames?.H1) riskBlocks.push("MISSING_TIMEFRAME_DATA");

  const portfolioDecision = riskBlocks.length ? "HOLD"
    : rawBias !== "HOLD" && confidence >= 55 && debateGap >= 1.5 ? rawBias : "HOLD";

  return {
    market,
    architecture: "TradingAgents-inspired analyst/debate/trader/risk/portfolio workflow",
    agents,
    debate: { bullishResearchers: bullCase, bearishResearchers: bearCase, bullishScore: bullScore, bearishScore: bearScore, scoreGap: debateGap },
    trader: { bias: rawBias, confidencePct: confidence },
    riskManager: { approved: riskBlocks.length === 0, blocks: riskBlocks, volatilityRatio: Number.isFinite(atr) && atrBase > 0 ? Number((atr / atrBase).toFixed(2)) : null },
    portfolioManager: { decision: portfolioDecision, reason: riskBlocks.length ? riskBlocks.join(", ") : portfolioDecision === "HOLD" ? "Insufficient agent agreement; wait for stronger evidence" : "Agent consensus and risk checks passed" }
  };
}

export function gateSignalWithAgents(signal, agentReport) {
  if (!["BUY", "SELL"].includes(signal)) return { signal: "HOLD", reason: "Technical engine did not produce a trade candidate" };
  if (!agentReport?.riskManager?.approved) return { signal: "HOLD", reason: "Risk manager veto: " + (agentReport?.riskManager?.blocks ?? []).join(", ") };
  if (agentReport.portfolioManager?.decision !== signal) {
    return { signal: "HOLD", reason: `Multi-agent decision ${agentReport.portfolioManager?.decision ?? "HOLD"} does not confirm technical candidate ${signal}` };
  }
  return { signal, reason: "Technical setup and multi-agent decision agree" };
}
