export function tradePlan(signal, result, confirmation) {
  if (!["BUY", "SELL"].includes(signal) ||
      confirmation?.status !== "H1 ALIGNED" ||
      !Number.isFinite(result?.atr14) || result.atr14 <= 0 ||
      !Number.isFinite(result?.close)) return null;

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
  return { entry, stopLoss, takeProfit, riskReward: "1:2", stopType, riskDistance: risk };
}

export function finalAction(signal, plan) {
  return plan ? signal : "NO TRADE";
}
