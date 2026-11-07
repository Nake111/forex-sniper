export function tradePlan(signal, result, confirmation) {
  if (![ "BUY", "SELL" ].includes(signal) ||
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
    if (Number.isFinite(swingLow) && swingLow < entry) candidates.push(swingLow - buffer);
    for (const zone of result.smartMoney?.orderBlocks ?? []) {
      if (zone.direction === "BULLISH" && !zone.invalidated &&
          zone.barsAgo <= 24 && Number.isFinite(zone.low) && zone.low < entry) {
        candidates.push(zone.low - buffer);
      }
    }
  } else {
    const swingHigh = result.structure?.swingHigh;
    if (Number.isFinite(swingHigh) && swingHigh > entry) candidates.push(swingHigh + buffer);
    for (const zone of result.smartMoney?.orderBlocks ?? []) {
      if (zone.direction === "BEARISH" && !zone.invalidated &&
          zone.barsAgo <= 24 && Number.isFinite(zone.high) && zone.high > entry) {
        candidates.push(zone.high + buffer);
      }
    }
  }

  // Prefer the nearest valid structural invalidation level. Reject stops
  // outside a 0.8–2.5 ATR envelope to avoid oversized or noise-tight risk.
  const validStops = candidates.filter(stop => {
    const distance = Math.abs(entry - stop);
    return bullish ? stop < entry && distance >= result.atr14 * 0.8 && distance <= result.atr14 * 2.5
      : stop > entry && distance >= result.atr14 * 0.8 && distance <= result.atr14 * 2.5;
  });
  let stopLoss;
  let stopType = "ATR_FALLBACK";
  if (validStops.length) {
    stopLoss = bullish ? Math.max(...validStops) : Math.min(...validStops);
    stopType = "MARKET_STRUCTURE";
  } else {
    stopLoss = bullish ? entry - atrRisk : entry + atrRisk;
  }

  const risk = Math.abs(entry - stopLoss);
  const takeProfit = bullish ? entry + risk * 2 : entry - risk * 2;
  return { entry, stopLoss, takeProfit, riskReward: "1:2", stopType, riskDistance: risk };
}

export function finalAction(signal, plan) {
  return plan ? signal : "NO TRADE";
}
