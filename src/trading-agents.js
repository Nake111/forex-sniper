// TradingAgents-inspired deterministic multi-agent decision layer.
// Six additional specialist agents independently inspect higher-timeframe alignment,
// volatility regime, M5 candle quality, momentum exhaustion, confirmed liquidity
// sweeps and session breakouts. All use only supplied closed-candle analysis fields.
// They are deterministic local specialists, not six additional paid LLM calls.

const directions = ["BUY", "SELL", "HOLD"];
const asDirection = value => value === "BULLISH" ? "BUY" : value === "BEARISH" ? "SELL" : "HOLD";

function vote(name, direction, weight, evidence) {
  return { name, direction: directions.includes(direction) ? direction : "HOLD", weight, evidence };
}

function directionalRegime(frame) {
  return frame?.regime === "BULL_TREND" ? "BUY"
    : frame?.regime === "BEAR_TREND" ? "SELL" : "HOLD";
}

function runAdditionalSpecialists(frames) {
  const { M5 = {}, M15 = {}, H1 = {}, H4 = {} } = frames ?? {};
  const agents = [];

  // 1) Higher-timeframe confluence: at least two aligned higher frames and no opposition.
  const higher = [M15, H1, H4].map(directionalRegime);
  const higherBuy = higher.filter(value => value === "BUY").length;
  const higherSell = higher.filter(value => value === "SELL").length;
  const higherDirection = higherBuy >= 2 && higherSell === 0 ? "BUY"
    : higherSell >= 2 && higherBuy === 0 ? "SELL" : "HOLD";
  agents.push(vote("Higher-timeframe confluence analyst", higherDirection, 0.75,
    `M15/H1/H4 regimes: ${higher.join("/")}; requires 2 aligned with no opposing frame`));

  // 2) Volatility/regime: directional trend only when ADX is established and ATR is not expanded.
  const atrRatio = Number.isFinite(M5.atr14) && Number.isFinite(M5.atrBaseline) && M5.atrBaseline > 0
    ? M5.atr14 / M5.atrBaseline : null;
  const volatilitySafe = atrRatio === null || (atrRatio >= 0.5 && atrRatio <= 1.8);
  const trendStrength = Number.isFinite(M5.adx14) && Number.isFinite(M15.adx14) &&
    M5.adx14 >= 18 && M15.adx14 >= 18;
  const regimeDirection = volatilitySafe && trendStrength &&
    directionalRegime(M5) === directionalRegime(M15) ? directionalRegime(M5) : "HOLD";
  agents.push(vote("Volatility and regime analyst", regimeDirection, 0.75,
    `M5/M15 ADX: ${M5.adx14 ?? "n/a"}/${M15.adx14 ?? "n/a"}; ATR ratio: ${atrRatio === null ? "n/a" : atrRatio.toFixed(2)}; ${M5.regime ?? "unknown"}`));

  // 3) Candle-quality confirmation: close must be directional and in the outer 35% of range.
  const candle = M5.lastCandle;
  const candleValid = candle && [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
    candle.high > candle.low && candle.close <= candle.high && candle.close >= candle.low;
  const closePosition = candleValid ? (candle.close - candle.low) / (candle.high - candle.low) : null;
  const candleDirection = candleValid && candle.close > candle.open && closePosition >= 0.65 ? "BUY"
    : candleValid && candle.close < candle.open && closePosition <= 0.35 ? "SELL" : "HOLD";
  agents.push(vote("M5 candle-quality analyst", candleDirection, 0.75,
    candleValid ? `M5 close position: ${(closePosition * 100).toFixed(0)}%; candle ${candle.close > candle.open ? "bullish" : candle.close < candle.open ? "bearish" : "doji"}`
      : "M5 OHLC candle unavailable or invalid"));

  // 4) Momentum/exhaustion: avoid chasing extremes; require RSI, Stoch RSI and CCI agreement.
  const momentumDirection = Number.isFinite(M5.rsi14) && M5.rsi14 >= 52 && M5.rsi14 <= 68 &&
      M5.stochRsi?.direction === "BULLISH" && Number.isFinite(M5.cci20) && M5.cci20 > 0 && M5.cci20 < 150 ? "BUY"
    : Number.isFinite(M5.rsi14) && M5.rsi14 >= 32 && M5.rsi14 <= 48 &&
      M5.stochRsi?.direction === "BEARISH" && Number.isFinite(M5.cci20) && M5.cci20 < 0 && M5.cci20 > -150 ? "SELL"
      : "HOLD";
  agents.push(vote("Momentum exhaustion analyst", momentumDirection, 0.75,
    `RSI: ${M5.rsi14 ?? "n/a"}; Stoch RSI: ${M5.stochRsi?.direction ?? "n/a"}; CCI: ${M5.cci20 ?? "n/a"}; avoids extreme chasing`));

  // 5) Liquidity sweep/reclaim: only a confirmed, recent sweep is directional evidence.
  const sweepDirection = M5.structure?.sweepConfirmed === true &&
      M5.structure?.liquiditySweep === "BULLISH" &&
      Number.isFinite(M5.structure?.liquiditySweepBarsAgo) && M5.structure.liquiditySweepBarsAgo <= 3 ? "BUY"
    : M5.structure?.sweepConfirmed === true &&
      M5.structure?.liquiditySweep === "BEARISH" &&
      Number.isFinite(M5.structure?.liquiditySweepBarsAgo) && M5.structure.liquiditySweepBarsAgo <= 3 ? "SELL"
      : "HOLD";
  agents.push(vote("Liquidity sweep and reclaim analyst", sweepDirection, 0.75,
    `Sweep: ${M5.structure?.liquiditySweep ?? "none"}; confirmed: ${M5.structure?.sweepConfirmed === true}; bars ago: ${M5.structure?.liquiditySweepBarsAgo ?? "n/a"}`));

  // 6) Session breakout: only a breakout of the prior active-session range can vote.
  const sessionDirection = asDirection(M5.sessionContext?.breakout);
  agents.push(vote("Trading-session breakout analyst", sessionDirection, 0.75,
    `Session: ${M5.sessionContext?.primary ?? "unknown"}; active: ${(M5.sessionContext?.active ?? []).join(", ") || "none"}; range breakout: ${M5.sessionContext?.breakout ?? "none"}`));

  return agents;
}

export function runTradingAgents({ market, frames, macro = {} }) {
  const { M5 = {}, M15 = {}, H1 = {} } = frames ?? {};
  const agents = [];

  // Existing specialist 1: trend alignment across execution and higher timeframes.
  const trendVotes = [M5, M15, H1].map(frame =>
    frame.regime === "BULL_TREND" ? 1 : frame.regime === "BEAR_TREND" ? -1 : 0);
  const trendSum = trendVotes.reduce((sum, value) => sum + value, 0);
  agents.push(vote("Technical analyst", trendSum >= 2 ? "BUY" : trendSum <= -2 ? "SELL" : "HOLD", 2,
    `M5/M15/H1 trend regime: ${trendVotes.join("/")}`));

  // Existing specialist 2: multiple independent momentum measures.
  const momentum = [
    M5.macdHistogram > 0 ? 1 : M5.macdHistogram < 0 ? -1 : 0,
    M15.macdHistogram > 0 ? 1 : M15.macdHistogram < 0 ? -1 : 0,
    M5.rsi14 >= 52 && M5.rsi14 <= 72 ? 1 : M5.rsi14 <= 48 && M5.rsi14 >= 28 ? -1 : 0,
    M5.supertrend?.direction === "BULLISH" ? 1 : M5.supertrend?.direction === "BEARISH" ? -1 : 0
  ];
  const momentumSum = momentum.reduce((sum, value) => sum + value, 0);
  agents.push(vote("Momentum analyst", momentumSum >= 2 ? "BUY" : momentumSum <= -2 ? "SELL" : "HOLD", 1.5,
    "MACD M5/M15, RSI and Supertrend"));

  // Existing specialist 3: BOS, liquidity sweep and OB/FVG context.
  const structureSignals = [M5.structure?.bos, M5.structure?.sweep]
    .map(value => value === "BULLISH" ? 1 : value === "BEARISH" ? -1 : 0);
  const bullishZones = (M5.smartMoney?.orderBlocks ?? []).some(z => z.direction === "BULLISH" && !z.invalidated);
  const bearishZones = (M5.smartMoney?.orderBlocks ?? []).some(z => z.direction === "BEARISH" && !z.invalidated);
  structureSignals.push(bullishZones && !bearishZones ? 1 : bearishZones && !bullishZones ? -1 : 0);
  const structureSum = structureSignals.reduce((sum, value) => sum + value, 0);
  agents.push(vote("SMC and liquidity analyst", structureSum >= 1 ? "BUY" : structureSum <= -1 ? "SELL" : "HOLD", 1.5,
    "BOS, liquidity sweep and active order-block context"));

  // Existing specialist 4: headlines and macro bias never imply direction on their own.
  const macroBias = macro.goldMacroBias === "BULLISH" ? "BUY"
    : macro.goldMacroBias === "BEARISH" ? "SELL" : "HOLD";
  agents.push(vote("Macro and news analyst", macroBias, 1,
    `Event risk: ${macro.eventRisk ?? "UNKNOWN"}; directional bias: ${macro.goldMacroBias ?? "UNCONFIRMED"}`));

  // Existing specialist 5: auction/value location and volume-pressure proxy.
  const valueSignals = [
    Number.isFinite(M5.vwap) ? (M5.close > M5.vwap ? 1 : M5.close < M5.vwap ? -1 : 0) : 0,
    Number.isFinite(M5.poc) ? (M5.close > M5.poc ? 1 : M5.close < M5.poc ? -1 : 0) : 0,
    M5.cvd?.direction === "BUYING" ? 1 : M5.cvd?.direction === "SELLING" ? -1 : 0
  ];
  const valueSum = valueSignals.reduce((sum, value) => sum + value, 0);
  agents.push(vote("Volume and auction analyst", valueSum >= 2 ? "BUY" : valueSum <= -2 ? "SELL" : "HOLD", 1,
    "VWAP, volume-profile POC and cumulative-volume pressure proxy"));

  // Six new local specialists; no new API calls or external credentials required.
  agents.push(...runAdditionalSpecialists(frames));

  const score = direction => agents.reduce((sum, agent) =>
    sum + (agent.direction === direction ? agent.weight : 0), 0);
  const bullScore = score("BUY");
  const bearScore = score("SELL");
  const totalDirectionalWeight = agents.reduce((sum, agent) => sum + agent.weight, 0);
  const strongest = Math.max(bullScore, bearScore);
  const rawBias = bullScore > bearScore ? "BUY" : bearScore > bullScore ? "SELL" : "HOLD";
  const confidence = totalDirectionalWeight ? Math.round(100 * strongest / totalDirectionalWeight) : 0;

  const bullCase = agents.filter(agent => agent.direction === "BUY").map(agent => agent.name);
  const bearCase = agents.filter(agent => agent.direction === "SELL").map(agent => agent.name);
  const debateGap = Math.abs(bullScore - bearScore);

  // Existing hard risk manager remains authoritative.
  const atr = M5.atr14;
  const atrBase = M5.atrBaseline;
  const volatilityExtreme = Number.isFinite(atr) && Number.isFinite(atrBase) && atrBase > 0 && atr / atrBase > 2.5;
  const riskBlocks = [];
  if (macro.eventRisk !== "NORMAL") riskBlocks.push("ECONOMIC_CALENDAR_" + (macro.eventRisk ?? "UNKNOWN"));
  if (macro.dataStale === true) riskBlocks.push("STALE_MARKET_DATA");
  if (volatilityExtreme) riskBlocks.push("ABNORMAL_VOLATILITY");
  if (!frames?.M5 || !frames?.M15 || !frames?.H1) riskBlocks.push("MISSING_TIMEFRAME_DATA");

  const portfolioDecision = riskBlocks.length ? "HOLD"
    : rawBias !== "HOLD" && confidence >= 55 && debateGap >= 1.5 ? rawBias : "HOLD";

  return {
    market,
    architecture: "11 local deterministic specialists + risk/debate/portfolio managers",
    agents,
    agentCount: agents.length,
    additionalSpecialists: agents.slice(5).map(agent => agent.name),
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
