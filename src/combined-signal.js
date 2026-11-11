// Unified BTCUSD decision engine. This is a research filter, not a profitability guarantee.
const finite = Number.isFinite;

function donchianAgrees(side, breakout, h1Aligned, m15, m5) {
  if (!breakout || !h1Aligned || m15.adx14 < 18 || m15.volumeRatio < 1.15) return false;
  if (side === "BUY") return m5.close > m5.ema20 && m5.rsi14 >= 50 && m5.rsi14 <= 72;
  return m5.close < m5.ema20 && m5.rsi14 <= 50 && m5.rsi14 >= 28;
}

export function evaluateCombinedSignal({ results, donchian, legacySignal = "HOLD", freshness = { ok: true } }) {
  const m5 = results?.M5, m15 = results?.M15, h1 = results?.H1;
  if (!m5 || !m15 || !h1 || !donchian?.M5 || !donchian?.M15 || !donchian?.H1) {
    return { signal: "HOLD", confirmation: "INSUFFICIENT DATA", scores: { bullish: 0, bearish: 0 }, reasons: [], blockers: ["Missing timeframe analysis"] };
  }
  if (!freshness?.ok) {
    return { signal: "HOLD", confirmation: "STALE DATA", scores: { bullish: 0, bearish: 0 }, reasons: [], blockers: freshness?.reasons ?? ["Market data is stale"] };
  }

  const d5 = donchian.M5, d15 = donchian.M15;
  const scores = { bullish: 0, bearish: 0 };
  const evidence = { bullish: [], bearish: [] };
  const add = (direction, weight, reason) => {
    if (direction === "BULLISH") { scores.bullish += weight; evidence.bullish.push(reason); }
    if (direction === "BEARISH") { scores.bearish += weight; evidence.bearish.push(reason); }
  };

  const h1Bull = finite(h1.ema200) && h1.close > h1.ema200 && h1.ema50 > h1.ema200;
  const h1Bear = finite(h1.ema200) && h1.close < h1.ema200 && h1.ema50 < h1.ema200;
  add(h1Bull ? "BULLISH" : h1Bear ? "BEARISH" : "NONE", 2, "H1 EMA50/EMA200 trend");
  add(m15.ema20 > m15.ema50 ? "BULLISH" : m15.ema20 < m15.ema50 ? "BEARISH" : "NONE", 1, "M15 EMA20/EMA50 alignment");
  add(m15.rsi14 > 52 ? "BULLISH" : m15.rsi14 < 48 ? "BEARISH" : "NONE", 1, "M15 RSI momentum");
  add(m15.macd > m15.macdSignal ? "BULLISH" : m15.macd < m15.macdSignal ? "BEARISH" : "NONE", 1, "M15 MACD direction");

  const bullBreak = d15.close > d15.channelHigh20 && d15.previousClose <= d15.previousChannelHigh20;
  const bearBreak = d15.close < d15.channelLow20 && d15.previousClose >= d15.previousChannelLow20;
  add(bullBreak ? "BULLISH" : bearBreak ? "BEARISH" : "NONE", 2, "M15 20-bar Donchian breakout");

  // Treat recent structure events consistently across the primary structure and SMC layers.
  // The previous engine only checked the swing BOS and could ignore a valid internal BOS.
  const structureAge = Number(m15.structure?.bosBarsAgo);
  const primaryBosRecent = Number.isFinite(structureAge) && structureAge >= 0 && structureAge <= 6;
  const primaryBosDirection = primaryBosRecent ? m15.structure?.bos : "NONE";
  const smcEvents = [m15.smartMoney?.swing, m15.smartMoney?.internal]
    .filter(event => event && event.type === "BOS")
    .map(event => ({ direction: event.direction, barsAgo: Number(event.barsAgo) }))
    .filter(event => ["BULLISH", "BEARISH"].includes(event.direction) &&
      Number.isFinite(event.barsAgo) && event.barsAgo >= 0 && event.barsAgo <= 6)
    .sort((a, b) => a.barsAgo - b.barsAgo);
  const recentSmcBos = smcEvents[0] ?? null;
  const bosDirection = primaryBosRecent && ["BULLISH", "BEARISH"].includes(primaryBosDirection)
    ? primaryBosDirection : recentSmcBos?.direction ?? "NONE";
  const bosRecent = bosDirection !== "NONE";
  if (primaryBosRecent && ["BULLISH", "BEARISH"].includes(primaryBosDirection)) {
    add(primaryBosDirection, 2, "M15 market-structure BOS");
  } else if (recentSmcBos) {
    add(recentSmcBos.direction, 2, "M15 SMC swing/internal BOS");
  }
  const smc = m15.smartMoney?.swing;
  if (smc && Number(smc.barsAgo) >= 0 && Number(smc.barsAgo) <= 4 && smc.type === "CHoCH") {
    add(smc.direction, 1, "M15 SMC change of character");
  }

  const zoneBuffer = finite(m15.atr14) ? m15.atr14 * 0.25 : 0;
  const nearZone = (price, low, high) => finite(price) && finite(low) && finite(high) &&
    price >= Math.min(low, high) - zoneBuffer && price <= Math.max(low, high) + zoneBuffer;
  const activeBlock = (m15.smartMoney?.orderBlocks ?? []).find(block =>
    !block.invalidated && ["FRESH", "TOUCHED"].includes(block.status) &&
    nearZone(m15.close, block.low, block.high)
  );
  if (activeBlock) add(activeBlock.direction, 1, "M15 SMC active order-block confluence");
  const activeGap = (m15.smartMoney?.fairValueGaps ?? []).find(gap =>
    !gap.filled && nearZone(m15.close, gap.bottom, gap.top)
  );
  if (activeGap) add(activeGap.direction, 1, "M15 unfilled fair-value-gap confluence");
  add(m15.close > m15.valueAreaHigh ? "BULLISH" :
      m15.close < m15.valueAreaLow ? "BEARISH" : "NONE", 1, "M15 Volume Profile value-area position");

  const sweep = m5.structure;
  add(sweep?.sweepConfirmed && sweep.liquiditySweep === "BULLISH" ? "BULLISH" :
      sweep?.sweepConfirmed && sweep.liquiditySweep === "BEARISH" ? "BEARISH" : "NONE", 1, "M5 confirmed liquidity sweep");

  const breakoutDirection = bullBreak ? "BULLISH" : bearBreak ? "BEARISH" : "NONE";
  if (breakoutDirection !== "NONE" && d15.adx14 >= 18) add(breakoutDirection, 1, "M15 ADX trend-strength filter");
  if (breakoutDirection !== "NONE" && d15.volumeRatio >= 1.15) add(breakoutDirection, 1, "M15 relative-volume confirmation");

  add(m5.close > m5.ema20 ? "BULLISH" : m5.close < m5.ema20 ? "BEARISH" : "NONE", 1, "M5 EMA20 trigger");
  add(m5.rsi14 >= 50 && m5.rsi14 <= 72 ? "BULLISH" :
      m5.rsi14 <= 50 && m5.rsi14 >= 28 ? "BEARISH" : "NONE", 1, "M5 RSI entry filter");
  add(m5.macd > m5.macdSignal ? "BULLISH" : m5.macd < m5.macdSignal ? "BEARISH" : "NONE", 1, "M5 MACD confirmation");
  add(m5.close > m5.poc ? "BULLISH" : m5.close < m5.poc ? "BEARISH" : "NONE", 1, "M5 Volume Profile POC position");

  const squeezeDirection = String(h1.squeeze?.direction ?? "");
  add(squeezeDirection.startsWith("BULLISH") ? "BULLISH" :
      squeezeDirection.startsWith("BEARISH") ? "BEARISH" : "NONE", 1, "H1 TTM Squeeze momentum direction");
  if (legacySignal === "BUY") add("BULLISH", 1, "Existing SMC/indicator signal agrees");
  if (legacySignal === "SELL") add("BEARISH", 1, "Existing SMC/indicator signal agrees");
  if (donchianAgrees("BUY", bullBreak, h1Bull, d15, d5)) add("BULLISH", 1, "Full Donchian strategy agrees");
  if (donchianAgrees("SELL", bearBreak, h1Bear, d15, d5)) add("BEARISH", 1, "Full Donchian strategy agrees");

  const blockers = [];
  if (!h1Bull && !h1Bear) blockers.push("H1 EMA50/EMA200 trend is not aligned");
  if (!bullBreak && !bearBreak && !bosRecent) blockers.push("No fresh M15 breakout or structure break");
  if ((bullBreak || bearBreak) && d15.adx14 < 18) blockers.push("M15 trend strength is weak (ADX below 18)");
  if ((bullBreak || bearBreak) && (!finite(d15.volumeRatio) || d15.volumeRatio < 1.15)) blockers.push("M15 breakout volume confirmation is missing");

  let signal = "HOLD";
  if (h1Bull && scores.bullish >= 8 && scores.bullish - scores.bearish >= 3 &&
      (bullBreak || (bosRecent && bosDirection === "BULLISH")) &&
      m5.close > m5.ema20 && m5.rsi14 >= 50 && m5.rsi14 <= 72) signal = "BUY";
  if (h1Bear && scores.bearish >= 8 && scores.bearish - scores.bullish >= 3 &&
      (bearBreak || (bosRecent && bosDirection === "BEARISH")) &&
      m5.close < m5.ema20 && m5.rsi14 <= 50 && m5.rsi14 >= 28) signal = "SELL";
  if (signal === "HOLD" && !blockers.length) blockers.push("Combined confirmation threshold not reached");

  return {
    signal,
    confirmation: signal === "HOLD" ? "NO TRADE" : "ALL FILTERS ALIGNED",
    scores,
    margin: Math.abs(scores.bullish - scores.bearish),
    reasons: signal === "BUY" ? evidence.bullish : signal === "SELL" ? evidence.bearish : [],
    bullishEvidence: evidence.bullish,
    bearishEvidence: evidence.bearish,
    blockers,
    components: {
      legacySignal,
      donchianBreakout: bullBreak ? "BUY" : bearBreak ? "SELL" : "NONE",
      h1Trend: h1Bull ? "BULLISH" : h1Bear ? "BEARISH" : "NEUTRAL"
    }
  };
}
