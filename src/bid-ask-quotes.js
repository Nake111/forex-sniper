const CAPITAL_MARKETS = Object.freeze({
  EURUSD: { searchTerm: "EUR/USD", match: market => {
    const text = [market.instrumentName, market.symbol, market.epic].join(" ").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return text.includes("EURUSD") && market.instrumentType === "CURRENCIES";
  } },
  XAUUSD: { searchTerm: "Gold", match: market => {
    const text = [market.instrumentName, market.symbol, market.epic].join(" ").toUpperCase();
    return text.includes("GOLD") && market.instrumentType === "COMMODITIES" && (market.expiry === "-" || !market.expiry);
  } }
});

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function normalizeCapitalMarket(market, symbol, receivedAt = Date.now()) {
  if (!market || !["EURUSD", "XAUUSD"].includes(symbol)) return null;
  const bid = finitePositive(market.bid);
  const ask = finitePositive(market.offer ?? market.ask);
  const timestamp = Date.parse(market.updateTimeUTC ?? market.updateTime ?? "");
  if (!bid || !ask || ask <= bid || !Number.isFinite(timestamp)) return null;
  return {
    market: symbol,
    symbol: symbol === "EURUSD" ? "EUR/USD" : "XAU/USD",
    bid, ask, price: (bid + ask) / 2,
    timestamp, receivedAt,
    source: "Capital.com REST market snapshot",
    venue: "Capital.com",
    epic: market.epic ?? null,
    tradeable: market.marketStatus === "TRADEABLE" && Number(market.delayTime ?? 0) === 0,
    marketStatus: market.marketStatus ?? "UNKNOWN",
    delayTime: Number(market.delayTime ?? 0),
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
    return { valid: false, reason: "Provider marks instrument as not tradeable or prices delayed" };
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
      method: options.method ?? "GET",
      headers: options.headers ?? {},
      body: options.body,
      signal: controller.signal
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return { data: await response.json(), headers: response.headers };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCapitalComQuotes({
  apiKey, identifier, apiPassword, environment = "demo", fetchImpl = fetch,
  markets = ["EURUSD", "XAUUSD"]
}) {
  const requested = markets.filter(market => CAPITAL_MARKETS[market]);
  if (!requested.length) return { quotes: {}, error: null };
  if (!apiKey || !identifier || !apiPassword) {
    return { quotes: {}, error: "Capital.com credentials missing: CAPITAL_API_KEY, CAPITAL_IDENTIFIER, CAPITAL_API_PASSWORD" };
  }
  const baseUrl = environment === "live"
    ? "https://api-capital.backend-capital.com"
    : "https://demo-api-capital.backend-capital.com";
  try {
    const session = await fetchJson(baseUrl + "/api/v1/session", {
      method: "POST",
      headers: { "X-CAP-API-KEY": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ identifier, password: apiPassword, encryptedPassword: false }),
      timeoutMs: 8_000
    }, fetchImpl);
    const cst = session.headers?.get?.("CST");
    const securityToken = session.headers?.get?.("X-SECURITY-TOKEN");
    if (!cst || !securityToken) throw new Error("Capital.com session response omitted CST or X-SECURITY-TOKEN");
    const headers = { CST: cst, "X-SECURITY-TOKEN": securityToken, Accept: "application/json" };
    const quotes = {};
    const errors = [];
    for (const symbol of requested) {
      try {
        const config = CAPITAL_MARKETS[symbol];
        const search = await fetchJson(
          baseUrl + "/api/v1/markets?searchTerm=" + encodeURIComponent(config.searchTerm),
          { headers, timeoutMs: 8_000 }, fetchImpl
        );
        const candidates = (search.data.markets ?? []).filter(config.match);
        const market = candidates.find(item => item.marketStatus === "TRADEABLE") ?? candidates[0];
        if (!market) {
          errors.push(symbol + ": Capital.com did not return a matching instrument");
          continue;
        }
        const quote = normalizeCapitalMarket(market, symbol);
        if (quote) quotes[symbol] = quote;
        else errors.push(symbol + ": Capital.com instrument had no valid bid/offer or provider timestamp");
      } catch (error) {
        errors.push(symbol + ": " + error.message);
      }
    }
    return { quotes, error: errors.length ? errors.join("; ") : null };
  } catch (error) {
    return { quotes: {}, error: "Capital.com session/pricing request failed: " + error.message };
  }
}

async function fetchKrakenQuote({ fetchImpl = fetch }) {
  try {
    const response = await fetchJson("https://api.kraken.com/0/public/Ticker?pair=XBTUSD", { timeoutMs: 5_000 }, fetchImpl);
    const quote = normalizeKrakenTicker(response.data);
    return { quote, error: quote ? null : "Kraken returned no valid XBT/USD order-book bid/ask" };
  } catch (error) {
    return { quote: null, error: "Kraken ticker request failed: " + error.message };
  }
}

export async function fetchBidAskQuotes({
  capitalApiKey = process.env.CAPITAL_API_KEY,
  capitalIdentifier = process.env.CAPITAL_IDENTIFIER,
  capitalApiPassword = process.env.CAPITAL_API_PASSWORD,
  capitalEnvironment = process.env.CAPITAL_ENVIRONMENT ?? "demo",
  fetchImpl = fetch,
  markets = ["EURUSD", "BTCUSD", "XAUUSD"]
} = {}) {
  const [capital, kraken] = await Promise.all([
    fetchCapitalComQuotes({
      apiKey: capitalApiKey, identifier: capitalIdentifier, apiPassword: capitalApiPassword,
      environment: capitalEnvironment, fetchImpl, markets
    }),
    markets.includes("BTCUSD") ? fetchKrakenQuote({ fetchImpl }) : Promise.resolve({ quote: null, error: null })
  ]);
  const quotes = { ...capital.quotes };
  if (kraken.quote) quotes.BTCUSD = kraken.quote;
  const errors = [capital.error, kraken.error].filter(Boolean);
  return {
    status: markets.every(market => Boolean(quotes[market])) ? "COMPLETE" : Object.keys(quotes).length ? "PARTIAL" : "UNAVAILABLE",
    provider: "Capital.com + Kraken",
    quotes,
    errors,
    receivedAt: Date.now()
  };
}
