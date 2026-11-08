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
    id: String(m.id), question: m.question, slug: m.slug, endDate: m.endDate || m.endDateIso || null,
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
  const upIndex = outcomes.findIndex(x => /^(up|yes)$/i.test(x) || x.includes("up"));
  const downIndex = outcomes.findIndex(x => /^(down|no)$/i.test(x) || x.includes("down"));
  if (upIndex < 0 || downIndex < 0 || upIndex === downIndex) return null;
  return { up: market.tokenIds[upIndex], down: market.tokenIds[downIndex] };
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
    status: "LIVE_QUOTES", market: { id: market.id, question: market.question, slug: market.slug, endDate: market.endDate, secondsToExpiry: secondsToExpiry(market.endDate, now), liquidity: market.liquidity, volume24h: market.volume24h },
    outcomes: { up: { tokenId: tokenMap.up, ...upBook }, down: { tokenId: tokenMap.down, ...downBook } },
    note: "Quotes are prediction-market prices, not a calibrated forecast. The underlying market's exact strike/reference and settlement rules must be parsed before issuing an expiry-direction signal."
  };
}
