const SYMBOLS = Object.freeze({
  EURUSD: "EURUSD",
  XAUUSD: "XAUUSD"
});

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function timestampMs(value) {
  if (typeof value === "number" || /^\d+(\.\d+)?$/.test(String(value ?? ""))) {
    const n = Number(value);
    return Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : NaN;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function normalizeBiquoteTick(payload, receivedAt = Date.now()) {
  const symbol = String(payload?.symbol ?? "").toUpperCase().replace("/", "");
  const market = Object.keys(SYMBOLS).find(key => SYMBOLS[key] === symbol);
  const bid = positive(payload?.bid);
  const ask = positive(payload?.ask);
  const timestamp = timestampMs(payload?.timestamp ?? payload?.lastQuoteAt);
  if (!market || !bid || !ask || ask <= bid || !Number.isFinite(timestamp)) return null;
  return {
    market,
    symbol: market === "EURUSD" ? "EUR/USD" : "XAU/USD",
    bid,
    ask,
    price: positive(payload?.mid) ?? (bid + ask) / 2,
    timestamp,
    receivedAt,
    source: "Biquote MT5 aggregated tick feed",
    venue: payload?.source ?? "Biquote",
    marketState: payload?.marketState ?? null,
    stale: payload?.stale ?? null,
    timestampQuality: "PROVIDER_TIMESTAMP",
    tradeable: payload?.marketState === "open" && payload?.stale !== true
  };
}

export function validateBiquoteTick(quote, { now = Date.now(), maxAgeMs = 15_000 } = {}) {
  if (!quote) return { valid: false, reason: "No Biquote tick received" };
  if (![quote.bid, quote.ask, quote.timestamp, quote.receivedAt].every(Number.isFinite))
    return { valid: false, reason: "Biquote bid/ask or timestamp is missing or invalid" };
  if (quote.bid <= 0 || quote.ask <= quote.bid)
    return { valid: false, reason: "Biquote bid/ask is crossed or non-positive" };
  const providerAgeMs = now - quote.timestamp;
  const receiveAgeMs = now - quote.receivedAt;
  if (providerAgeMs < -2_000 || receiveAgeMs < 0)
    return { valid: false, reason: "Biquote timestamp is in the future" };
  if (providerAgeMs > maxAgeMs || receiveAgeMs > maxAgeMs)
    return { valid: false, reason: "Biquote quote is stale" };
  if (quote.marketState !== "open" || quote.stale === true || quote.tradeable === false)
    return { valid: false, reason: "Biquote market is closed or quote is stale" };
  return {
    valid: true,
    ageMs: Math.max(0, providerAgeMs),
    spread: quote.ask - quote.bid,
    spreadPct: ((quote.ask - quote.bid) / ((quote.ask + quote.bid) / 2)) * 100,
    timestampQuality: quote.timestampQuality
  };
}

export async function fetchBiquoteQuote(market, {
  fetchImpl = fetch,
  timeoutMs = 5_000
} = {}) {
  if (!SYMBOLS[market]) return { quote: null, error: "Unsupported Biquote market: " + market };
  try {
    const response = await fetchImpl(
      "https://biquote.io/api/" + SYMBOLS[market] + "?allowStale=false",
      { signal: AbortSignal.timeout(timeoutMs) }
    );
    if (!response.ok) throw new Error("HTTP " + response.status);
    const payload = await response.json();
    const quote = normalizeBiquoteTick(payload);
    const validation = validateBiquoteTick(quote);
    if (!validation.valid) throw new Error(validation.reason);
    return { quote, error: null };
  } catch (error) {
    return { quote: null, error: "Biquote " + market + " request failed: " + error.message };
  }
}
