const OANDA_INSTRUMENTS = Object.freeze({ EURUSD: "EUR_USD", XAUUSD: "XAU_USD" });

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function normalizeOandaPrice(instrument, payload, receivedAt = Date.now()) {
  const market = Object.entries(OANDA_INSTRUMENTS).find(([, value]) => value === instrument)?.[0];
  if (!market || !payload || payload.instrument !== instrument) return null;
  const bid = finitePositive(payload.bids?.[0]?.price);
  const ask = finitePositive(payload.asks?.[0]?.price);
  const timestamp = Date.parse(payload.time ?? "");
  if (!bid || !ask || ask <= bid || !Number.isFinite(timestamp)) return null;
  return {
    market, symbol: instrument.replace("_", "/"), bid, ask, price: (bid + ask) / 2,
    timestamp, receivedAt, source: "OANDA pricing API",
    venue: "OANDA", tradeable: payload.tradeable === true,
    timestampQuality: "PROVIDER_TIMESTAMP"
  };
}

export function normalizeKrakenTicker(payload, receivedAt = Date.now()) {
  const result = payload?.result;
  if (!result || payload.error?.length) return null;
  const entry = Object.entries(result).find(([key]) => key.toUpperCase().includes("XBTUSD")) ??
    Object.entries(result)[0];
  if (!entry) return null;
  const [pair, ticker] = entry;
  const bid = finitePositive(ticker?.b?.[0]);
  const ask = finitePositive(ticker?.a?.[0]);
  if (!bid || !ask || ask <= bid) return null;
  return {
    market: "BTCUSD", symbol: "XBT/USD", bid, ask, price: (bid + ask) / 2,
    timestamp: receivedAt, receivedAt, source: "Kraken public ticker order book",
    venue: "Kraken", venuePair: pair, tradeable: true,
    timestampQuality: "RECEIVED_AT_ONLY"
  };
}

export function validateBidAskQuote(quote, { now = Date.now(), maxAgeMs = 15_000 } = {}) {
  if (!quote) return { valid: false, reason: "No bid/ask quote received" };
  if (![quote.bid, quote.ask, quote.timestamp, quote.receivedAt].every(Number.isFinite))
    return { valid: false, reason: "Bid/ask or timestamp is missing or invalid" };
  if (quote.bid <= 0 || quote.ask <= quote.bid)
    return { valid: false, reason: "Bid/ask is crossed or non-positive" };
  const providerAgeMs = now - quote.timestamp;
  const receiveAgeMs = now - quote.receivedAt;
  if (providerAgeMs < -2_000 || receiveAgeMs < 0)
    return { valid: false, reason: "Quote timestamp is in the future" };
  if (providerAgeMs > maxAgeMs || receiveAgeMs > maxAgeMs)
    return { valid: false, reason: "Quote is stale" };
  if (quote.tradeable === false)
    return { valid: false, reason: "Provider marks instrument as not tradeable" };
  return {
    valid: true, ageMs: Math.max(0, providerAgeMs),
    spread: quote.ask - quote.bid,
    spreadPct: ((quote.ask - quote.bid) / ((quote.ask + quote.bid) / 2)) * 100,
    timestampQuality: quote.timestampQuality ?? "UNKNOWN"
  };
}

async function fetchJson(url, options = {}, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
  try {
    const response = await fetchImpl(url, {
      headers: options.headers ?? {}, signal: controller.signal
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOandaQuotes({ token, accountId, environment = "practice", fetchImpl = fetch }) {
  if (!token || !accountId) return { quotes: {}, error: "OANDA_API_TOKEN and OANDA_ACCOUNT_ID are not both configured" };
  const host = environment === "live" ? "https://api-fxtrade.oanda.com" : "https://api-fxpractice.oanda.com";
  const instruments = Object.values(OANDA_INSTRUMENTS).join(",");
  try {
    const data = await fetchJson(
      host + "/v3/accounts/" + encodeURIComponent(accountId) + "/pricing?instruments=" + encodeURIComponent(instruments),
      { headers: { Authorization: "Bearer " + token, Accept: "application/json" }, timeoutMs: 5_000 },
      fetchImpl
    );
    const quotes = {};
    for (const price of data.prices ?? []) {
      const quote = normalizeOandaPrice(price.instrument, price);
      if (quote) quotes[quote.market] = quote;
    }
    return { quotes, error: Object.keys(quotes).length ? null : "OANDA returned no valid EUR/USD or XAU/USD bid/ask prices" };
  } catch (error) {
    return { quotes: {}, error: "OANDA pricing request failed: " + error.message };
  }
}

async function fetchKrakenQuote({ fetchImpl = fetch }) {
  try {
    const data = await fetchJson("https://api.kraken.com/0/public/Ticker?pair=XBTUSD", { timeoutMs: 5_000 }, fetchImpl);
    const quote = normalizeKrakenTicker(data);
    return { quote, error: quote ? null : "Kraken returned no valid XBT/USD order-book bid/ask" };
  } catch (error) {
    return { quote: null, error: "Kraken ticker request failed: " + error.message };
  }
}

export async function fetchBidAskQuotes({
  oandaToken = process.env.OANDA_API_TOKEN,
  oandaAccountId = process.env.OANDA_ACCOUNT_ID,
  oandaEnvironment = process.env.OANDA_ENVIRONMENT ?? "practice",
  fetchImpl = fetch
} = {}) {
  const [oanda, kraken] = await Promise.all([
    fetchOandaQuotes({ token: oandaToken, accountId: oandaAccountId, environment: oandaEnvironment, fetchImpl }),
    fetchKrakenQuote({ fetchImpl })
  ]);
  const quotes = { ...oanda.quotes };
  if (kraken.quote) quotes.BTCUSD = kraken.quote;
  const errors = [oanda.error, kraken.error].filter(Boolean);
  return {
    status: Object.keys(quotes).length === 3 ? "COMPLETE" : Object.keys(quotes).length ? "PARTIAL" : "UNAVAILABLE",
    provider: "OANDA + Kraken",
    quotes,
    errors,
    receivedAt: Date.now()
  };
}
