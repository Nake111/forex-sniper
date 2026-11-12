const API_BASE = "https://financialdata.net/api/v1";
const PAGE_SIZE = 300;
const MARKET_ENDPOINTS = Object.freeze({
  EURUSD: { endpoint: "forex-minute-prices", premium: true },
  BTCUSD: { endpoint: "crypto-minute-prices", premium: false }
});

function parseUtcTimestamp(value) {
  if (typeof value === "number" || (typeof value === "string" && /^\\d+(?:\\.\\d+)?$/.test(value))) {
    const n = Number(value);
    return Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : NaN;
  }
  if (typeof value !== "string") return NaN;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  return Date.parse(/(?:Z|[+-]\\d{2}:?\\d{2})$/i.test(normalized) ? normalized : normalized + "Z");
}

function normalizeRows(rows, market, now) {
  if (!Array.isArray(rows)) throw new Error("FinancialData.Net response is not an array");
  return rows.map(row => ({
    timestamp: parseUtcTimestamp(row.time ?? row.timestamp ?? row.date),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume ?? 0),
    source: "FinancialData.Net " + market + " 1-minute"
  })).filter(candle =>
    Number.isFinite(candle.timestamp) &&
    [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
    candle.open > 0 && candle.high >= Math.max(candle.open, candle.close, candle.low) &&
    candle.low <= Math.min(candle.open, candle.close, candle.high) &&
    Number.isFinite(candle.volume) && candle.volume >= 0 &&
    candle.timestamp + 60_000 <= now
  ).sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Fetch the most recent one-minute bars. FinancialData.Net returns up to 300
 * records per request; page count is deliberately bounded to control usage.
 * EURUSD requires the provider's Premium Forex entitlement; BTCUSD minute
 * history is listed under Standard crypto data.
 */
export async function fetchFdnMinuteCandles(market, {
  apiKey = process.env.FDN_API_KEY,
  fetchImpl = fetch,
  now = Date.now(),
  maxPages = 1
} = {}) {
  const config = MARKET_ENDPOINTS[market];
  if (!config) return { status: "UNSUPPORTED_MARKET", candles: [], error: market + " has no configured FDN minute endpoint" };
  const normalizedApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!normalizedApiKey) return { status: "NOT_CONFIGURED", candles: [], error: "FDN_API_KEY is not configured or contains only whitespace" };
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 5) {
    throw new Error("FDN_MAX_PAGES must be an integer from 1 to 5");
  }

  const date = new Date(now).toISOString().slice(0, 10);
  const collected = [];
  try {
    for (let page = 0; page < maxPages; page++) {
      const url = new URL(API_BASE + "/" + config.endpoint);
      url.search = new URLSearchParams({
        identifier: market,
        date,
        offset: String(page * PAGE_SIZE),
        format: "json",
        key: normalizedApiKey
      }).toString();
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(12_000), headers: { accept: "application/json" } });
      if (response.status === 401 || response.status === 403) {
        let authDiagnosis = "API key rejected or endpoint access denied";
        try {
          const probeUrl = new URL(API_BASE + "/stock-symbols");
          probeUrl.search = new URLSearchParams({ format: "json", key: normalizedApiKey }).toString();
          const probe = await fetchImpl(probeUrl, { signal: AbortSignal.timeout(8_000), headers: { accept: "application/json" } });
          if (probe.ok) {
            authDiagnosis = "API key accepted by the free stock-symbols endpoint; this minute-data endpoint is not authorized for the account or plan";
          } else if (probe.status === 401 || probe.status === 403) {
            authDiagnosis = "API key rejected by the free stock-symbols endpoint too; verify the key value in GitHub Actions secrets";
          } else {
            authDiagnosis = "Minute endpoint denied access (HTTP " + response.status + "); key probe returned HTTP " + probe.status;
          }
        } catch (probeError) {
          authDiagnosis = "Minute endpoint denied access (HTTP " + response.status + "); key validation probe failed: " + probeError.message;
        }
        throw new Error("HTTP " + response.status + " — " + authDiagnosis);
      }
      if (!response.ok) throw new Error("HTTP " + response.status);
      const payload = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error("API error or unexpected payload: " + JSON.stringify(payload).slice(0, 300));
      }
      collected.push(...payload);
      if (payload.length < PAGE_SIZE) break;
    }
    const candles = normalizeRows(collected, market, now);
    const unique = [...new Map(candles.map(candle => [candle.timestamp, candle])).values()];
    if (!unique.length) throw new Error("No valid closed one-minute candles returned");
    return {
      status: "OK",
      market,
      endpoint: config.endpoint,
      entitlement: config.premium ? "PREMIUM_FOREX_REQUIRED" : "STANDARD_CRYPTO",
      requestedAt: now,
      providerTimezone: "UTC",
      candles: unique
    };
  } catch (error) {
    return { status: "UNAVAILABLE", market, candles: [], error: "FinancialData.Net request failed: " + error.message };
  }
}

export function resampleFdnMinuteCandles(candles, minutes = 5) {
  if (!Array.isArray(candles) || !Number.isInteger(minutes) || minutes < 1 || 60 % minutes !== 0) {
    throw new Error("Expected minute candles and a timeframe that divides 60");
  }
  const duration = minutes * 60_000;
  const groups = new Map();
  for (const candle of candles) {
    const bucket = Math.floor(candle.timestamp / duration) * duration;
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(candle);
  }
  const output = [];
  for (const [timestamp, rows] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    rows.sort((a, b) => a.timestamp - b.timestamp);
    if (rows.length !== minutes) continue;
    if (rows.some((row, index) => row.timestamp !== timestamp + index * 60_000)) continue;
    output.push({
      timestamp,
      open: rows[0].open,
      high: Math.max(...rows.map(row => row.high)),
      low: Math.min(...rows.map(row => row.low)),
      close: rows.at(-1).close,
      volume: rows.reduce((sum, row) => sum + row.volume, 0),
      source: "FinancialData.Net " + minutes + "-minute resampled from UTC M1"
    });
  }
  return output;
}

export async function fetchFdnM5Candles(market, options = {}) {
  const result = await fetchFdnMinuteCandles(market, options);
  if (result.status !== "OK") return { ...result, candles: [] };
  const candles = resampleFdnMinuteCandles(result.candles, 5);
  if (!candles.length) {
    return { ...result, status: "UNAVAILABLE", candles: [], error: "No complete closed M5 candles could be built from FDN M1 data" };
  }
  return { ...result, timeframe: "M5", candles };
}
