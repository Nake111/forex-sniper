
export function tradePlan(signal, result, confirmation) {
  if (
    !["BUY", "SELL"].includes(signal) ||
    !["H1 ALIGNED", "ALL FILTERS ALIGNED"].includes(confirmation?.status) ||
    !Number.isFinite(result?.atr14) ||
    result.atr14 <= 0 ||
    !Number.isFinite(result?.close)
  ) {
    return null;
  }

  const entry = result.close;
  const risk = result.atr14 * 1.5;
  const reward = result.atr14 * 3;

  if (signal === "BUY") {
    return {
      entry,
      stopLoss: entry - risk,
      takeProfit: entry + reward,
      riskReward: "1:2"
    };
  }

  return {
    entry,
    stopLoss: entry + risk,
    takeProfit: entry - reward,
    riskReward: "1:2"
  };
}

export function finalAction(signal, plan) {
  return plan ? signal : "NO TRADE";
}
