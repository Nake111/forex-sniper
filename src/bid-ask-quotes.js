export async function fetchRealtimeFeedQuotes({
  url = process.env.REALTIME_FEED_URL,
  fetchImpl = fetch,
  markets = ["EURUSD", "BTCUSD", "XAUUSD"],
  now = Date.now()
} = {}) {
  if (!url) return { status: "NOT_CONFIGURED", quotes: {}, errors: [] };
  try {
    const base = String(url).replace(/\/+$/, "");
    const response = await fetchImpl(base + "/quotes", { signal: AbortSignal.timeout(4_000) });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const payload = await response.json();
    const feedServerTime = Number(payload?.updatedAt);
    const feedClockSkewMs = feedServerTime - now;
    const quotes = {};
    const errors = [];
    if (!Number.isFinite(feedServerTime) || Math.abs(feedClockSkewMs) > 10_000) {
      throw new Error("Realtime feed server clock is missing or differs from client clock by more than 10 seconds");
    }
    for (const market of markets) {
      const quote = payload?.quotes?.[market];
      const marketHealth = payload?.markets?.[market];
      if (!quote) { errors.push(market + ": no quote in realtime feed"); continue; }
      if (marketHealth?.status !== "FRESH" || !Number.isFinite(marketHealth?.ageMs) ||
          marketHealth.ageMs < 0 || marketHealth.ageMs > 15_000 ||
          marketHealth.timestamp !== quote.timestamp || marketHealth.bid !== quote.bid || marketHealth.ask !== quote.ask) {
        errors.push(market + ": feed-side health check or quote snapshot does not match");
        continue;
      }
      if (quote.timestampQuality !== "PROVIDER_TIMESTAMP") {
        errors.push(market + ": provider timestamp unavailable; receipt time alone is not sufficient");
        continue;
      }
      const validation = market === "BTCUSD"
        ? validateBidAskQuote(quote, { now: feedServerTime, maxAgeMs: 15_000 })
        : validateBiquoteTick(quote, { now: feedServerTime, maxAgeMs: 15_000 });
      if (!validation.valid) { errors.push(market + ": " + validation.reason); continue; }
      quotes[market] = { ...quote, feedServerTime, source: "Railway continuous realtime feed", realtime: true };
    }
    return {
      status: markets.every(market => quotes[market]) ? "COMPLETE" : Object.keys(quotes).length ? "PARTIAL" : "UNAVAILABLE",
      quotes, errors, provider: "Railway continuous feed", feedServerTime, feedClockSkewMs, receivedAt: now
    };
  } catch (error) {
    return { status: "UNAVAILABLE", quotes: {}, errors: ["Realtime feed request failed: " + error.message] };
  }
}

import { fetchTwelveDataQuotes } from "./twelve-data-quotes.js";
import { normalizeCoinbaseTicker } from "./realtime-feed-core.js";
import { fetchBiquoteQuote, validateBiquoteTick } from "./biquote-quotes.js";

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
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
    market: "BTCUSD",
    symbol: "BTC/USD",
    bid,
    ask,
    price: (bid + ask) / 2,
    timestamp: receivedAt,
    receivedAt,
    source: "Kraken public ticker order book",
    venue: "Kraken",
    venuePair: pair,
    tradeable: true,
    timestampQuality: "RECEIVED_AT_ONLY"
  };
}

export function validateBidAskQuote(quote, { now = Date.now(), maxAgeMs = 15_000 } = {}) {
  if (!quote) return { valid: false, reason: "No bid/ask quote received" };
  if (![quote.bid, quote.ask, quote.timestamp, quote.receivedAt].every(Number.isFinite)) {
    return { valid: false, reason: "Bid/ask or timestamp is missing or invalid" };
  }
  if (quote.bid <= 0 || quote.ask <= quote.bid) {
    return { valid: false, reason: "Bid/ask is crossed or non-positive" };
  }
  const providerAgeMs = now - quote.timestamp;
  const receiveAgeMs = now - quote.receivedAt;
  if (providerAgeMs < -2_000 || receiveAgeMs < 0) {
    return { valid: false, reason: "Quote timestamp is in the future" };
  }
  if (providerAgeMs > maxAgeMs || receiveAgeMs > maxAgeMs) {
    return { valid: false, reason: "Quote is stale" };
  }
  if (quote.timestampQuality !== "PROVIDER_TIMESTAMP") {
    return { valid: false, reason: "Provider-supplied quote timestamp is required; receive-time-only quotes are diagnostic only" };
  }
  if (quote.tradeable === false) {
    return { valid: false, reason: "Provider marks instrument as not tradeable or prices delayed" };
  }
  return {
    valid: true,
    ageMs: Math.max(0, providerAgeMs),
    spread: quote.ask - quote.bid,
    spreadPct: ((quote.ask - quote.bid) / ((quote.ask + quote.bid) / 2)) * 100,
    timestampQuality: quote.timestampQuality ?? "PROVIDER_TIMESTAMP"
  };
}

export function normalizeCoinbaseRestTicker(payload, receivedAt = Date.now()) {
  const quote = normalizeCoinbaseTicker({
    type: "ticker", product_id: "BTC-USD", time: payload?.time,
    best_bid: payload?.bid ?? payload?.best_bid,
    best_ask: payload?.ask ?? payload?.best_ask
  }, receivedAt);
  if (!quote || quote.timestampQuality !== "PROVIDER_TIMESTAMP") return null;
  return { ...quote, source: "Coinbase Exchange BTC-USD ticker REST",
    venue: "Coinbase Exchange", tradeable: true };
}

async function fetchCoinbaseQuote(fetchImpl = fetch) {
  try {
    const response = await fetchImpl(
      "https://api.exchange.coinbase.com/products/BTC-USD/ticker",
      { signal: AbortSignal.timeout(5_000), headers: { accept: "application/json" } }
    );
    if (!response.ok) throw new Error("HTTP " + response.status);
    const quote = normalizeCoinbaseRestTicker(await response.json());
    if (!quote) throw new Error("Coinbase returned no provider-timestamped BTC/USD bid/ask");
    const validation = validateBidAskQuote(quote);
    if (!validation.valid) throw new Error(validation.reason);
    return { quote, error: null };
  } catch (error) {
    return { quote: null, error: "Coinbase BTC/USD ticker request failed: " + error.message };
  }
}

async function fetchKrakenQuote(fetchImpl = fetch) {
  try {
    const response = await fetchImpl(
      "https://api.kraken.com/0/public/Ticker?pair=XBTUSD",
      { signal: AbortSignal.timeout(5_000) }
    );
    if (!response.ok) throw new Error("HTTP " + response.status);
    const quote = normalizeKrakenTicker(await response.json());
    return { quote, error: quote ? null : "Kraken returned no valid XBT/USD bid/ask" };
  } catch (error) {
    return { quote: null, error: "Kraken ticker request failed: " + error.message };
  }
}

/**
 * Direct quote policy for the GitHub signal pipeline:
 * Biquote = EURUSD/XAUUSD; Coinbase Exchange = BTCUSD; Twelve Data is a
 * validated provider-timestamped fallback. The optional Railway stream is
 * intentionally not used for paper-approval decisions.
 */
export async function fetchBidAskQuotes({
  fetchImpl = fetch,
  markets = ["EURUSD", "BTCUSD", "XAUUSD"]
} = {}) {
  const requested = [...new Set(markets)].filter(symbol =>
    ["EURUSD", "BTCUSD", "XAUUSD"].includes(symbol)
  );
  const quotes = {};
  const errors = [];
  const nonCryptoMarkets = requested.filter(symbol => symbol !== "BTCUSD");
  const biquoteResults = await Promise.all(nonCryptoMarkets.map(async symbol => [
    symbol, await fetchBiquoteQuote(symbol, { fetchImpl })
  ]));
  const missingMarkets = [];
  for (const [symbol, result] of biquoteResults) {
    const validation = validateBiquoteTick(result.quote);
    if (validation.valid) {
      quotes[symbol] = { ...result.quote, venue: result.quote.venue ?? "Biquote MT5 feed",
        source: "Biquote live bid/ask" };
    } else {
      errors.push(result.error ?? symbol + ": " + validation.reason);
      missingMarkets.push(symbol);
    }
  }

  if (requested.includes("BTCUSD")) {
    const coinbase = await fetchCoinbaseQuote(fetchImpl);
    if (coinbase.quote) quotes.BTCUSD = coinbase.quote;
    else {
      errors.push(coinbase.error);
      missingMarkets.push("BTCUSD");
    }
  }

  // Fallback is accepted only if the provider supplies bid, ask and its own timestamp.
  if (missingMarkets.length) {
    const feed = await fetchTwelveDataQuotes({ markets: missingMarkets, requireBidAsk: true });
    for (const symbol of missingMarkets) {
      const quote = feed.quotes?.[symbol];
      const validation = validateBidAskQuote(quote);
      if (validation.valid && quote.timestampQuality === "PROVIDER_TIMESTAMP") {
        quotes[symbol] = { ...quote, venue: quote.exchange ?? "Twelve Data reference feed",
          source: "Twelve Data WebSocket bid/ask fallback" };
      } else {
        errors.push(symbol + ": " + (validation.reason ?? feed.errors?.join("; ") ?? "Twelve Data quote unavailable"));
      }
    }
    if (feed.errors?.length) errors.push(...feed.errors);
  }

  const complete = requested.length > 0 && requested.every(symbol => Boolean(quotes[symbol]));
  return {
    status: complete ? "COMPLETE" : Object.keys(quotes).length ? "PARTIAL" : "UNAVAILABLE",
    provider: "Biquote EURUSD/XAUUSD + Coinbase BTCUSD (Twelve Data timestamped fallback; no Railway dependency)",
    quotes, errors, receivedAt: Date.now()
  };
}
