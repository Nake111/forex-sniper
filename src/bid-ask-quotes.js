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
    const quotes = {};
    const errors = [];
    for (const market of markets) {
      const quote = payload?.quotes?.[market];
      if (!quote) { errors.push(market + ": no quote in realtime feed"); continue; }
      const validation = market === "BTCUSD"
        ? validateBidAskQuote(quote, { now, maxAgeMs: 15_000 })
        : validateBiquoteTick(quote, { now, maxAgeMs: 15_000 });
      if (!validation.valid) { errors.push(market + ": " + validation.reason); continue; }
      quotes[market] = { ...quote, source: "Railway continuous realtime feed", realtime: true };
    }
    return {
      status: markets.every(market => quotes[market]) ? "COMPLETE" : Object.keys(quotes).length ? "PARTIAL" : "UNAVAILABLE",
      quotes, errors, provider: "Railway continuous feed", receivedAt: Date.now()
    };
  } catch (error) {
    return { status: "UNAVAILABLE", quotes: {}, errors: ["Realtime feed request failed: " + error.message] };
  }
}

import { fetchTwelveDataQuotes } from "./twelve-data-quotes.js";
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

export async function fetchBidAskQuotes({
  fetchImpl = fetch,
  markets = ["EURUSD", "BTCUSD", "XAUUSD"]
} = {}) {
  const requested = [...new Set(markets)].filter(symbol =>
    ["EURUSD", "BTCUSD", "XAUUSD"].includes(symbol)
  );
  const realtime = await fetchRealtimeFeedQuotes({ fetchImpl, markets: requested });
  const quotes = { ...realtime.quotes };
  const errors = [...realtime.errors];

  const nonCryptoMarkets = requested.filter(symbol => symbol !== "BTCUSD" && !quotes[symbol]);
  if (nonCryptoMarkets.length) {
    const biquoteResults = await Promise.all(nonCryptoMarkets.map(async symbol => [
      symbol, await fetchBiquoteQuote(symbol, { fetchImpl })
    ]));
    const missingMarkets = [];
    for (const [symbol, result] of biquoteResults) {
      const validation = validateBiquoteTick(result.quote);
      if (validation.valid) {
        quotes[symbol] = {
          ...result.quote,
          venue: result.quote.venue ?? "Biquote MT5 feed",
          source: "Biquote live bid/ask"
        };
      } else {
        errors.push(result.error ?? symbol + ": " + validation.reason);
        missingMarkets.push(symbol);
      }
    }

    // Twelve Data remains a secondary fallback, but its price WebSocket does
    // not guarantee bid/ask fields for every symbol or subscription tier.
    if (missingMarkets.length) {
      const feed = await fetchTwelveDataQuotes({ markets: missingMarkets, requireBidAsk: true });
      for (const symbol of missingMarkets) {
        const quote = feed.quotes?.[symbol];
        const validation = validateBidAskQuote(quote);
        if (validation.valid) quotes[symbol] = {
          ...quote,
          venue: quote.exchange ?? "Twelve Data reference feed",
          source: "Twelve Data WebSocket bid/ask fallback"
        };
        else errors.push(symbol + ": " + (validation.reason ?? feed.errors?.join("; ") ?? "Twelve Data quote unavailable"));
      }
      if (feed.errors?.length) errors.push(...feed.errors);
    }
  }

  if (requested.includes("BTCUSD") && !quotes.BTCUSD) {
    const kraken = await fetchKrakenQuote(fetchImpl);
    if (kraken.quote && validateBidAskQuote(kraken.quote).valid) {
      quotes.BTCUSD = kraken.quote;
    } else {
      errors.push(kraken.error ?? "Kraken BTC/USD quote failed validation");
      const fallback = await fetchTwelveDataQuotes({ markets: ["BTCUSD"], requireBidAsk: true });
      const quote = fallback.quotes?.BTCUSD;
      const validation = validateBidAskQuote(quote);
      if (validation.valid) {
        quotes.BTCUSD = {
          ...quote,
          venue: quote.exchange ?? "Twelve Data reference feed",
          source: "Twelve Data WebSocket bid/ask fallback"
        };
      } else {
        errors.push("BTCUSD Twelve Data fallback: " + (validation.reason ?? "quote unavailable"));
      }
    }
  }

  const complete = requested.length > 0 && requested.every(symbol => Boolean(quotes[symbol]));
  return {
    status: complete ? "COMPLETE" : Object.keys(quotes).length ? "PARTIAL" : "UNAVAILABLE",
    provider: "Biquote + Kraken (Twelve Data fallback; no Capital.com)",
    quotes,
    errors,
    receivedAt: Date.now()
  };
}
