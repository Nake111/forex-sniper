export function evaluateLiveMarketSync({
  signals,
  marketData,
  now = Date.now(),
  maxQuoteAgeMs = 15_000,
  maxQuoteSkewMs = 15_000,
  maxCandleAgeMs = 600_000
} = {}) {
  const markets = ["EURUSD", "BTCUSD", "XAUUSD"];
  const failures = [];
  const signalCycle = signals?.analysisCycle?.id;
  const dataCycle = marketData?.analysisCycle?.id;
  if (!signalCycle || signalCycle !== dataCycle) failures.push("Signal and candle snapshots do not share one analysis cycle");
  if (marketData?.validation?.status !== "PASS") failures.push("Market-data validation is not PASS");
  const quoteTimes = [];
  const candleTimes = [];
  const perMarket = {};

  for (const market of markets) {
    const signal = signals?.markets?.[market];
    const candle = marketData?.markets?.[market]?.timeframes?.M5;
    const issues = [];
    if (!signal) issues.push("Signal missing");
    if (signal && signal.analysisCycle?.id !== signalCycle) issues.push("Signal analysis cycle mismatch");
    if (!candle || candle.status !== "PASS") issues.push("M5 closed-candle data is missing or not PASS");
    if (candle?.gapCount !== 0) issues.push("M5 candle intervals contain gaps");
    const candleTime = Date.parse(candle?.latestClosedAt ?? "");
    if (!Number.isFinite(candleTime)) issues.push("M5 latest-closed timestamp is missing or invalid");
    else {
      candleTimes.push(candleTime);
      const candleAge = now - candleTime;
      if (candleAge < -60_000 || candleAge > maxCandleAgeMs) issues.push("M5 latest-closed candle is future-dated or stale");
    }

    const quote = signal?.quote;
    const quoteTime = Number(quote?.timestamp);
    const quoteAge = now - quoteTime;
    if (quote?.validated !== true || quote?.timestampQuality !== "PROVIDER_TIMESTAMP" ||
        !(Number(quote?.bid) > 0) || !(Number(quote?.ask) > Number(quote?.bid)) ||
        !Number.isFinite(quoteTime) || quoteAge < -2_000 || quoteAge > maxQuoteAgeMs) {
      issues.push("Provider-timestamped bid/ask is missing, invalid, or stale");
    } else quoteTimes.push(quoteTime);
    if (signal?.quoteRefresh?.status !== "PASS") issues.push("Final publication quote refresh did not PASS");
    perMarket[market] = { status: issues.length ? "BLOCKED" : "PASS", issues,
      quoteAgeMs: Number.isFinite(quoteTime) ? Math.round(quoteAge) : null,
      candleAgeMs: Number.isFinite(candleTime) ? Math.round(now - candleTime) : null };
    failures.push(...issues.map(issue => market + ": " + issue));
  }

  if (candleTimes.length === markets.length && new Set(candleTimes).size !== 1) {
    failures.push("Markets do not share the same latest closed M5 candle timestamp");
  }
  const quoteSkewMs = quoteTimes.length === markets.length
    ? Math.max(...quoteTimes) - Math.min(...quoteTimes) : null;
  if (quoteSkewMs !== null && quoteSkewMs > maxQuoteSkewMs) {
    failures.push("Provider quote timestamps are not synchronized within " + maxQuoteSkewMs + "ms");
  }
  return {
    status: failures.length ? "BLOCKED" : "PASS",
    checkedAt: new Date(now).toISOString(),
    analysisCycleId: signalCycle ?? null,
    thresholds: { maxQuoteAgeMs, maxQuoteSkewMs, maxCandleAgeMs },
    quoteTimestampSkewMs: quoteSkewMs,
    sharedClosedM5Timestamp: candleTimes.length === markets.length && new Set(candleTimes).size === 1
      ? new Date(candleTimes[0]).toISOString() : null,
    failures,
    markets: perMarket
  };
}
