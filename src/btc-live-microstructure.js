const DEFAULT_URL = "https://btc-10-second-feed-production.up.railway.app/latest";
const MAX_AGE_MS = 30_000;
const INTERVAL_MS = 10_000;

export async function getBtcLiveMicrostructure() {
  const url = process.env.BTC_LIVE_FEED_URL ?? DEFAULT_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" }
    });
    if (!response.ok) throw new Error(`feed returned HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.symbol !== "BTC-USD" || payload.intervalSeconds !== 10 ||
        !String(payload.source ?? "").includes("Coinbase spot")) {
      throw new Error("unexpected feed symbol, interval, or source");
    }
    const lastTradeAt = Number(payload.lastTradeAt);
    const ageMs = Date.now() - lastTradeAt;
    if (!Number.isFinite(lastTradeAt) || ageMs < -5_000 || ageMs > MAX_AGE_MS ||
        payload.status !== "live") {
      throw new Error("live BTC feed is stale or has an invalid timestamp");
    }
    const candles = (Array.isArray(payload.candles) ? payload.candles : [])
      .filter(c => Number.isFinite(Number(c.timestamp)) &&
        [c.open, c.high, c.low, c.close, c.volume].every(v => Number.isFinite(Number(v))) &&
        Number(c.high) >= Math.max(Number(c.open), Number(c.close), Number(c.low)) &&
        Number(c.low) <= Math.min(Number(c.open), Number(c.close), Number(c.high)) &&
        Number(c.timestamp) + INTERVAL_MS <= Date.now())
      .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
      .slice(-3);
    if (candles.length < 3) throw new Error("fewer than three closed 10-second candles");
    for (let i = 1; i < candles.length; i += 1) {
      if (Number(candles[i].timestamp) - Number(candles[i - 1].timestamp) !== INTERVAL_MS ||
          candles[i].gapBefore) {
        throw new Error("gap detected in the latest 10-second candles");
      }
    }
    const first = candles[0];
    const last = candles.at(-1);
    const up = candles.filter(c => Number(c.close) > Number(c.open)).length;
    const down = candles.filter(c => Number(c.close) < Number(c.open)).length;
    const netChange = Number(last.close) - Number(first.open);
    const direction = netChange > 0 && up >= 2 ? "BUY"
      : netChange < 0 && down >= 2 ? "SELL" : "NEUTRAL";
    return {
      status: "LIVE",
      symbol: "BTC-USD",
      source: payload.source,
      ageMs,
      direction,
      netChange,
      upCandles: up,
      downCandles: down,
      candles
    };
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      direction: "UNKNOWN",
      reason: error.name === "AbortError" ? "feed request timed out" : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}
