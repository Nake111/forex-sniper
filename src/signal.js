export const SIGNAL_PROFILES = {
  baseline: { minM5Votes: 3, minM15Votes: 3, minH1Votes: 2, maxOpposingH1Votes: 2, minBullishRsi: 50, maxBearishRsi: 50 },
  strict: { minM5Votes: 3, minM15Votes: 3, minH1Votes: 3, maxOpposingH1Votes: 1, minBullishRsi: 55, maxBearishRsi: 45 },
  institutional: { minScore: 9, minScoreGap: 3, minM5Adx: 18, minM15Adx: 18, maxRetestBars: 12 },
  advanced: {
    minM5Votes: 3, minM15Votes: 3, minH1Votes: 3, maxOpposingH1Votes: 1,
    minBullishRsi: 55, maxBearishRsi: 45, requireVwapCvd: true,
    minM5Adx: 18, minM15Adx: 18, requireRetest: true, maxRetestBars: 12
  }
};

export function hasDirectionalRetest(frame, direction, maxBars = 12) {
  const candle = frame?.lastCandle;
  if (!candle || ![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) return false;
  const bullish = direction === "BULLISH";
  if (bullish ? candle.close <= candle.open : candle.close >= candle.open) return false;
  const zones = [
    ...(frame.smartMoney?.orderBlocks ?? []).filter(zone =>
      zone.direction === direction && !zone.invalidated &&
      Number.isFinite(zone.high) && Number.isFinite(zone.low) &&
      Number.isFinite(zone.midpoint) && zone.barsAgo >= 1 && zone.barsAgo <= maxBars
    ).map(zone => ({ high: zone.high, low: zone.low, midpoint: zone.midpoint })),
    ...(frame.smartMoney?.fairValueGaps ?? []).filter(zone =>
      zone.direction === direction && !zone.filled &&
      Number.isFinite(zone.top) && Number.isFinite(zone.bottom) &&
      zone.barsAgo >= 1 && zone.barsAgo <= maxBars
    ).map(zone => ({ high: zone.top, low: zone.bottom, midpoint: (zone.top + zone.bottom) / 2 }))
  ];
  return zones.some(zone => {
    const overlaps = candle.low <= zone.high && candle.high >= zone.low;
    const rejected = bullish ? candle.close > zone.midpoint : candle.close < zone.midpoint;
    return overlaps && rejected;
  });
}

export function scoreInstitutionalSetup({ M5, M15, H1 }, macro = {}) {
  const bullish = [], bearish = [];
  const add = (condition, points, label) => {
    if (condition === "BULLISH") { bullish.push({ points, label }); return; }
    if (condition === "BEARISH") { bearish.push({ points, label }); }
  };
  add(H1?.regime === "BULL_TREND" ? "BULLISH" : H1?.regime === "BEAR_TREND" ? "BEARISH" : null, 2, "H1 EMA50/200 trend");
  add(M15?.regime === "BULL_TREND" ? "BULLISH" : M15?.regime === "BEAR_TREND" ? "BEARISH" : null, 2, "M15 EMA50/200 trend");
  add(M5?.regime === "BULL_TREND" ? "BULLISH" : M5?.regime === "BEAR_TREND" ? "BEARISH" : null, 1, "M5 EMA50/200 trend");
  add(Number.isFinite(M5?.adx14) && Number.isFinite(M15?.adx14) && M5.adx14 >= 18 && M15.adx14 >= 18
    ? (M5.close >= M5.ema50 && M15.close >= M15.ema50 ? "BULLISH" : M5.close <= M5.ema50 && M15.close <= M15.ema50 ? "BEARISH" : null) : null, 1, "Trend strength");
  add(Number.isFinite(M5?.rsi14) && M5.rsi14 >= 52 && M5.rsi14 <= 70 ? "BULLISH"
    : Number.isFinite(M5?.rsi14) && M5.rsi14 <= 48 && M5.rsi14 >= 30 ? "BEARISH" : null, 1, "RSI momentum");
  add(Number.isFinite(M5?.macdHistogram) && M5.macdHistogram > 0 ? "BULLISH"
    : Number.isFinite(M5?.macdHistogram) && M5.macdHistogram < 0 ? "BEARISH" : null, 1, "MACD momentum");
  add(Number.isFinite(M5?.vwap) && M5.close > M5.vwap && M5.cvd?.direction === "BUYING" && M5.cvd?.slope > 0 ? "BULLISH"
    : Number.isFinite(M5?.vwap) && M5.close < M5.vwap && M5.cvd?.direction === "SELLING" && M5.cvd?.slope < 0 ? "BEARISH" : null, 1, "VWAP and volume pressure proxy");
  add(M5?.supertrend?.direction === "BULLISH" ? "BULLISH" : M5?.supertrend?.direction === "BEARISH" ? "BEARISH" : null, 1, "Supertrend");
  add(M15?.ichimoku?.direction === "BULLISH" ? "BULLISH" : M15?.ichimoku?.direction === "BEARISH" ? "BEARISH" : null, 1, "M15 Ichimoku cloud");
  add(Number.isFinite(M5?.mfi14) && M5.mfi14 > 55 ? "BULLISH" : Number.isFinite(M5?.mfi14) && M5.mfi14 < 45 ? "BEARISH" : null, 1, "MFI money-flow pressure");
  add(Number.isFinite(M5?.cci20) && M5.cci20 > 50 ? "BULLISH" : Number.isFinite(M5?.cci20) && M5.cci20 < -50 ? "BEARISH" : null, 1, "CCI momentum");
  add(M5?.stochRsi?.direction === "BULLISH" ? "BULLISH" : M5?.stochRsi?.direction === "BEARISH" ? "BEARISH" : null, 1, "Stochastic RSI momentum");
  add(M5?.psar?.direction === "BULLISH" ? "BULLISH" : M5?.psar?.direction === "BEARISH" ? "BEARISH" : null, 1, "Parabolic SAR trend");
  add(M5?.donchian?.breakout === "BULLISH" ? "BULLISH" : M5?.donchian?.breakout === "BEARISH" ? "BEARISH" : null, 1, "Donchian 20 breakout");
  add(M5?.obv?.direction === "BUYING" ? "BULLISH" : M5?.obv?.direction === "SELLING" ? "BEARISH" : null, 1, "OBV volume pressure (tick-volume proxy)");
  add(Number.isFinite(M5?.poc) && M5.close > M5.poc ? "BULLISH"
    : Number.isFinite(M5?.poc) && M5.close < M5.poc ? "BEARISH" : null, 1, "Volume profile POC");
  add(M5?.structure?.bos === "BULLISH" || M5?.structure?.sweep === "BULLISH" ? "BULLISH"
    : M5?.structure?.bos === "BEARISH" || M5?.structure?.sweep === "BEARISH" ? "BEARISH" : null, 2, "Structure or liquidity sweep");
  add(hasDirectionalRetest(M5, "BULLISH", 12) ? "BULLISH"
    : hasDirectionalRetest(M5, "BEARISH", 12) ? "BEARISH" : null, 2, "OB/FVG directional retest");
  const bullScore = bullish.reduce((sum, item) => sum + item.points, 0);
  const bearScore = bearish.reduce((sum, item) => sum + item.points, 0);
  const blocked = macro?.eventRisk === "HIGH";
  const signal = !blocked && bullScore >= 9 && bullScore - bearScore >= 3 ? "BUY"
    : !blocked && bearScore >= 9 && bearScore - bullScore >= 3 ? "SELL" : "HOLD";
  return {
    signal, bullishScore: bullScore, bearishScore: bearScore,
    scoreScale: 22, eventRisk: macro?.eventRisk ?? "UNKNOWN",
    reasons: signal === "BUY" ? bullish.map(x => x.label) : signal === "SELL" ? bearish.map(x => x.label) : [],
    blockedReason: blocked ? "Recent high-impact macro headline: wait for volatility to settle" : null
  };
}

export function evaluateSignal({ M5, M15, H1 }, profile = "baseline", macro = {}) {
  const rules = typeof profile === "string" ? SIGNAL_PROFILES[profile] : profile;
  if (!rules) throw new Error(`Unknown signal profile: ${profile}`);
  const structure = M5?.structure ?? {};
  const bullishStructure = structure.bos === "BULLISH" || structure.sweep === "BULLISH" ||
    (structure.sweepConfirmed && structure.liquiditySweep === "BULLISH");
  const bearishStructure = structure.bos === "BEARISH" || structure.sweep === "BEARISH" ||
    (structure.sweepConfirmed && structure.liquiditySweep === "BEARISH");
  const valid = [M5, M15, H1].every(frame => frame &&
    Number.isFinite(frame.close) && Number.isFinite(frame.ema20) &&
    Number.isFinite(frame.ema50) && Number.isFinite(frame.rsi14) &&
    Number.isFinite(frame.macd) && Number.isFinite(frame.macdSignal));
  if (!valid) return "HOLD";
  if (profile === "institutional") return scoreInstitutionalSetup({ M5, M15, H1 }, macro).signal;

  const bullish = M5.bullishVotes >= rules.minM5Votes &&
    M15.bullishVotes >= rules.minM15Votes && H1.bullishVotes >= rules.minH1Votes &&
    H1.bearishVotes <= rules.maxOpposingH1Votes && M5.rsi14 >= rules.minBullishRsi &&
    bullishStructure && (!Number.isFinite(M5.poc) || M5.close > M5.poc) &&
    (!Number.isFinite(rules.minM5Adx) || (Number.isFinite(M5.adx14) && M5.adx14 >= rules.minM5Adx)) &&
    (!Number.isFinite(rules.minM15Adx) || (Number.isFinite(M15.adx14) && M15.adx14 >= rules.minM15Adx)) &&
    (!rules.requireVwapCvd || (Number.isFinite(M5.vwap) && M5.close > M5.vwap && M5.cvd?.direction === "BUYING" && M5.cvd?.slope > 0)) &&
    (!rules.requireRetest || hasDirectionalRetest(M5, "BULLISH", rules.maxRetestBars));

  const bearish = M5.bearishVotes >= rules.minM5Votes &&
    M15.bearishVotes >= rules.minM15Votes && H1.bearishVotes >= rules.minH1Votes &&
    H1.bullishVotes <= rules.maxOpposingH1Votes && M5.rsi14 <= rules.maxBearishRsi &&
    bearishStructure && (!Number.isFinite(M5.poc) || M5.close < M5.poc) &&
    (!Number.isFinite(rules.minM5Adx) || (Number.isFinite(M5.adx14) && M5.adx14 >= rules.minM5Adx)) &&
    (!Number.isFinite(rules.minM15Adx) || (Number.isFinite(M15.adx14) && M15.adx14 >= rules.minM15Adx)) &&
    (!rules.requireVwapCvd || (Number.isFinite(M5.vwap) && M5.close < M5.vwap && M5.cvd?.direction === "SELLING" && M5.cvd?.slope < 0)) &&
    (!rules.requireRetest || hasDirectionalRetest(M5, "BEARISH", rules.maxRetestBars));

  if (bullish && !bearish) return "BUY";
  if (bearish && !bullish) return "SELL";
  return "HOLD";
}

export function confirmSignal(signal, H1) {
  if (signal === "HOLD") return { status: "NO TRADE" };
  const squeeze = H1?.squeeze;
  if (!squeeze || !Number.isFinite(squeeze.momentum)) return { status: "WAIT", reason: "Missing H1 momentum confirmation" };
  if (squeeze.state === "SQUEEZE_ON") return { status: "WAIT", reason: "H1 volatility squeeze is still active" };
  const aligned = signal === "BUY"
    ? squeeze.momentum > 0 && squeeze.direction?.startsWith("BULLISH")
    : squeeze.momentum < 0 && squeeze.direction?.startsWith("BEARISH");
  return aligned ? { status: "H1 ALIGNED" } : { status: "WAIT", reason: "H1 momentum does not confirm direction" };
}
