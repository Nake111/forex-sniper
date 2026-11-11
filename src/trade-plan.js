function validEntryTrigger(signal, result) {
  const candle = result?.lastCandle;
  if (!candle || ![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) return false;
  if (Math.abs(candle.close - result.close) > Math.max(result.atr14 * 0.05, 1e-10)) return false;
  const range = candle.high - candle.low;
  if (!(range > 0) || candle.high < Math.max(candle.open, candle.close) ||
      candle.low > Math.min(candle.open, candle.close)) return false;
  const closeLocation = (candle.close - candle.low) / range;
  return signal === "BUY"
    ? candle.close > candle.open && closeLocation >= 0.65
    : candle.close < candle.open && closeLocation <= 0.35;
}

export function tradePlan(signal, result, confirmation) {
  if (!["BUY", "SELL"].includes(signal) ||
      confirmation?.status !== "H1 ALIGNED" ||
      !Number.isFinite(result?.atr14) || result.atr14 <= 0 ||
      !Number.isFinite(result?.close) || !validEntryTrigger(signal, result)) return null;

  const entry = result.close;
  const atrRisk = result.atr14 * 1.5;
  const buffer = result.atr14 * 0.15;
  const bullish = signal === "BUY";
  const candidates = [];

  if (bullish) {
    const swingLow = result.structure?.swingLow;
    if (Number.isFinite(swingLow) && swingLow < entry &&
        Number.isFinite(result.structure?.swingLowBarsAgo) && result.structure.swingLowBarsAgo <= 36) {
      candidates.push(swingLow - buffer);
    }
    for (const zone of result.smartMoney?.orderBlocks ?? []) {
      if (zone.direction === "BULLISH" && !zone.invalidated && zone.barsAgo >= 1 &&
          zone.barsAgo <= 24 && Number.isFinite(zone.low) && zone.low < entry) candidates.push(zone.low - buffer);
    }
  } else {
    const swingHigh = result.structure?.swingHigh;
    if (Number.isFinite(swingHigh) && swingHigh > entry &&
        Number.isFinite(result.structure?.swingHighBarsAgo) && result.structure.swingHighBarsAgo <= 36) {
      candidates.push(swingHigh + buffer);
    }
    for (const zone of result.smartMoney?.orderBlocks ?? []) {
      if (zone.direction === "BEARISH" && !zone.invalidated && zone.barsAgo >= 1 &&
          zone.barsAgo <= 24 && Number.isFinite(zone.high) && zone.high > entry) candidates.push(zone.high + buffer);
    }
  }

  const validStops = candidates.filter(stop => {
    const distance = Math.abs(entry - stop);
    return distance >= result.atr14 * 0.8 && distance <= result.atr14 * 2.5 &&
      (bullish ? stop < entry : stop > entry);
  });
  const stopLoss = validStops.length
    ? (bullish ? Math.max(...validStops) : Math.min(...validStops))
    : (bullish ? entry - atrRisk : entry + atrRisk);
  const stopType = validStops.length ? "MARKET_STRUCTURE" : "ATR_FALLBACK";
  const risk = Math.abs(entry - stopLoss);
  const takeProfit = bullish ? entry + risk * 2 : entry - risk * 2;
  const reward = Math.abs(takeProfit - entry);
  const riskRewardValue = risk > 0 ? reward / risk : 0;
  if (![entry, stopLoss, takeProfit, risk, reward].every(Number.isFinite) ||
      risk <= 0 || riskRewardValue < 2 ||
      (bullish ? !(stopLoss < entry && takeProfit > entry) : !(stopLoss > entry && takeProfit < entry))) return null;
  return { entry, stopLoss, takeProfit, riskReward: "1:2", riskRewardValue, stopType, riskDistance: risk, entryTrigger: "M5_DIRECTIONAL_CLOSE" };
}

export function finalAction(signal, plan) {
  return plan ? signal : "NO TRADE";
}


const MARKET_PLAN_SETTINGS = Object.freeze({
  EURUSD: { stopAtr: 1.4, rewardRisk: 2.0, bufferAtr: 0.12, minStopAtr: 0.7, maxStopAtr: 2.6 },
  BTCUSD: { stopAtr: 1.8, rewardRisk: 2.0, bufferAtr: 0.18, minStopAtr: 0.9, maxStopAtr: 3.2 },
  XAUUSD: { stopAtr: 1.6, rewardRisk: 2.0, bufferAtr: 0.15, minStopAtr: 0.8, maxStopAtr: 2.8 }
});

/**
 * Calculates indicative levels from a directional candidate, regardless of
 * H1/agent/Gemini approval. It never marks the levels executable by itself.
 */
export function buildIndicativeTradePlan(signal, result, market) {
  const settings = MARKET_PLAN_SETTINGS[market];
  if (!settings || !["BUY", "SELL"].includes(signal) ||
      !Number.isFinite(result?.atr14) || result.atr14 <= 0 ||
      !Number.isFinite(result?.close) || result.close <= 0) return null;

  const bullish = signal === "BUY";
  const entry = result.close;
  const buffer = result.atr14 * settings.bufferAtr;
  const structureStops = [];
  if (bullish) {
    const swingLow = result.structure?.swingLow;
    if (Number.isFinite(swingLow) && swingLow < entry) structureStops.push(swingLow - buffer);
    for (const zone of result.smartMoney?.orderBlocks ?? []) {
      if (zone.direction === "BULLISH" && !zone.invalidated && Number.isFinite(zone.low) && zone.low < entry) {
        structureStops.push(zone.low - buffer);
      }
    }
  } else {
    const swingHigh = result.structure?.swingHigh;
    if (Number.isFinite(swingHigh) && swingHigh > entry) structureStops.push(swingHigh + buffer);
    for (const zone of result.smartMoney?.orderBlocks ?? []) {
      if (zone.direction === "BEARISH" && !zone.invalidated && Number.isFinite(zone.high) && zone.high > entry) {
        structureStops.push(zone.high + buffer);
      }
    }
  }


  const validStops = structureStops.filter(stop => {
    const distance = Math.abs(entry - stop);
    return distance >= result.atr14 * settings.minStopAtr &&
      distance <= result.atr14 * settings.maxStopAtr &&
      (bullish ? stop < entry : stop > entry);
  });
  const stopLoss = validStops.length
    ? (bullish ? Math.max(...validStops) : Math.min(...validStops))
    : (bullish ? entry - result.atr14 * settings.stopAtr : entry + result.atr14 * settings.stopAtr);
  const riskDistance = Math.abs(entry - stopLoss);
  const takeProfit = bullish
    ? entry + riskDistance * settings.rewardRisk
    : entry - riskDistance * settings.rewardRisk;
  const entryTriggerConfirmed = validEntryTrigger(signal, result);

  if (![entry, stopLoss, takeProfit, riskDistance].every(Number.isFinite) ||
      riskDistance <= 0 || (bullish ? !(stopLoss < entry && takeProfit > entry) : !(stopLoss > entry && takeProfit < entry))) {
    return null;
  }
  return {
    market, direction: signal, entry, stopLoss, takeProfit,
    riskReward: "1:" + settings.rewardRisk.toFixed(1),
    riskRewardValue: settings.rewardRisk,
    stopType: validStops.length ? "MARKET_STRUCTURE" : "MARKET_SPECIFIC_ATR",
    riskDistance,
    entryTriggerConfirmed,
    status: entryTriggerConfirmed ? "TRIGGER_CONFIRMED — awaiting execution gates" : "INDICATIVE — M5 trigger not confirmed",
    executable: false
  };
}
