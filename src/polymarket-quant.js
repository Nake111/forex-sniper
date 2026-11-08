// Read-only Polymarket BTC Up/Down market discovery and expiry-aware context.
const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const fetchJson = async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return response.json();
};
const parseArray = value => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") { try { return JSON.parse(value); } catch { return []; } }
  return [];
};
export function isBtcUpDownMarket(market) {
  const text = String(market?.question || "");
  return /bitcoin|\bbtc\b/i.test(text) && /up\s*(or|\/|-)\s*down/i.test(text);
}
export async function discoverBtcUpDownMarkets({ active = true, limit = 100 } = {}) {
  const params = new URLSearchParams({ active: String(active), closed: String(!active), limit: String(Math.min(500, Math.max(1, limit))), order: "endDate", ascending: "true" });
  const data = await fetchJson(`${GAMMA}/markets?${params}`);
  return (Array.isArray(data) ? data : []).filter(isBtcUpDownMarket).map(m => ({
    id: String(m.id), question: m.question, slug: m.slug, startDate: m.startDate || m.startDateIso || null, endDate: m.endDate || m.endDateIso || null,
    outcomes: parseArray(m.outcomes), outcomePrices: parseArray(m.outcomePrices).map(Number),
    tokenIds: parseArray(m.clobTokenIds).map(String), liquidity: Number(m.liquidityNum ?? m.liquidity ?? 0),
    volume24h: Number(m.volume24hr ?? 0), closed: Boolean(m.closed), active: Boolean(m.active),
    description: String(m.description || "")
  })).filter(m => m.tokenIds.length >= 2);
}
export function secondsToExpiry(endDate, now = Date.now()) {
  const end = Date.parse(endDate);
  return Number.isFinite(end) ? Math.max(0, Math.floor((end - now) / 1000)) : null;
}
export function mapOutcomeTokens(market) {
  const outcomes = market.outcomes.map(x => String(x).toLowerCase());
  const upIndex = outcomes.findIndex(x => x === "up" || x.includes("up"));
  const downIndex = outcomes.findIndex(x => x === "down" || x.includes("down"));
  if (upIndex < 0 || downIndex < 0 || upIndex === downIndex) return null;
  return { up: market.tokenIds[upIndex], down: market.tokenIds[downIndex] };
}

function normalCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}
async function expirySpotProxy(market, now) {
  const start = Date.parse(market.startDate || "");
  const secondsLeft = secondsToExpiry(market.endDate, now);
  if (!Number.isFinite(start) || secondsLeft === null || secondsLeft <= 0) {
    return { status: "UNAVAILABLE", reason: "Missing market start/end timestamps or market already expired." };
  }
  const minute = Math.floor(start / 60000) * 60000;
  const [referenceRows, recentRows, ticker] = await Promise.all([
    fetchJson(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=${minute}&endTime=${minute + 60000}&limit=1`),
    fetchJson("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=61"),
    fetchJson("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT")
  ]);
  if (!Array.isArray(referenceRows) || !referenceRows.length || !Array.isArray(recentRows) || recentRows.length < 20) {
    return { status: "UNAVAILABLE", reason: "Insufficient Binance spot reference/history candles." };
  }
  const strikeProxy = Number(referenceRows[0][1]);
  const current = Number(ticker.price);
  const closes = recentRows.map(row => Number(row[4])).filter(Number.isFinite);
  const returns = closes.slice(1).map((value, i) => Math.log(value / closes[i]));
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  const sigma = Math.sqrt(variance);
  if (!(strikeProxy > 0 && current > 0 && sigma > 0)) return { status: "UNAVAILABLE", reason: "Invalid strike proxy, spot quote or volatility estimate." };
  const minutesLeft = secondsLeft / 60;
  const z = (Math.log(current / strikeProxy) + mean * minutesLeft) / (sigma * Math.sqrt(minutesLeft));
  const probabilityUp = Math.min(0.999, Math.max(0.001, normalCdf(z)));
  return {
    status: "PROXY_ESTIMATE",
    referencePrice: strikeProxy,
    currentSpot: current,
    probabilityUpPct: Number((probabilityUp * 100).toFixed(2)),
    probabilityDownPct: Number(((1 - probabilityUp) * 100).toFixed(2)),
    secondsToExpiry: secondsLeft,
    oneMinuteLogReturnMean: mean,
    oneMinuteLogReturnSigma: sigma,
    model: "Drifted lognormal approximation using recent Binance BTCUSDT 1m returns",
    limitations: "Binance candle open is only a proxy for the market's official Chainlink/reference price; market startDate alignment and settlement source must be verified. Not calibrated and not a trade signal."
  };
}

export async function getPolymarketBtcContext({ now = Date.now() } = {}) {
  const markets = await discoverBtcUpDownMarkets({ active: true, limit: 200 });
  const market = markets.filter(m => secondsToExpiry(m.endDate, now) > 0)
    .sort((a, b) => Date.parse(a.endDate) - Date.parse(b.endDate))[0];
  if (!market) return { status: "NO_ACTIVE_MARKET", market: null };
  const tokenMap = mapOutcomeTokens(market);
  if (!tokenMap) return { status: "UNKNOWN_OUTCOME_MAPPING", market, note: "Outcome labels were not safely identifiable; no UP/DOWN mapping assumed." };
  const [upBook, downBook] = await Promise.all([tokenMap.up, tokenMap.down].map(async tokenId => {
    const book = await fetchJson(`${CLOB}/book?token_id=${encodeURIComponent(tokenId)}`);
    const bids = (book.bids || []).map(x => Number(x.price)).filter(Number.isFinite);
    const asks = (book.asks || []).map(x => Number(x.price)).filter(Number.isFinite);
    return { bestBid: bids.length ? Math.max(...bids) : null, bestAsk: asks.length ? Math.min(...asks) : null };
  }));
  return {
    status: "LIVE_QUOTES", market: { id: market.id, question: market.question, slug: market.slug, startDate: market.startDate, endDate: market.endDate, secondsToExpiry: secondsToExpiry(market.endDate, now), liquidity: market.liquidity, volume24h: market.volume24h },
    expiryForecast: await expirySpotProxy(market, now),
    outcomes: { up: { tokenId: tokenMap.up, ...upBook }, down: { tokenId: tokenMap.down, ...downBook } },
    note: "Quotes are prediction-market prices, not a calibrated forecast. The underlying market's exact strike/reference and settlement rules must be parsed before issuing an expiry-direction signal."
  };
}
