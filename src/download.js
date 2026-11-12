import { getHistoricalRates } from "dukascopy-node";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

const DATA_DIR = process.env.DATA_DIR ?? "data";
const DAYS_BACK = Number(process.env.DATA_DAYS_BACK ?? 180);
const OVERLAP_DAYS = Number(process.env.DATA_OVERLAP_DAYS ?? 3);
const MARKETS = [
  { label: "EUR/USD", instrument: "eurusd", prefix: "eurusd" },
  { label: "BTC/USD", instrument: "btcusd", prefix: "btcusd" },
  { label: "Gold XAU/USD", instrument: "xauusd", prefix: "xauusd" }
];
const TIMEFRAMES = ["m5", "m15", "h1", "h4"];
const MARKET_FILTER = process.env.MARKET_FILTER?.toUpperCase();
const DOWNLOAD_CONCURRENCY = Number(process.env.DOWNLOAD_CONCURRENCY ?? 6);
if (!Number.isInteger(DOWNLOAD_CONCURRENCY) || DOWNLOAD_CONCURRENCY < 1 || DOWNLOAD_CONCURRENCY > 6) {
  throw new Error("DOWNLOAD_CONCURRENCY must be an integer between 1 and 6");
}
if (!Number.isInteger(OVERLAP_DAYS) || OVERLAP_DAYS < 1 || OVERLAP_DAYS > 14) {
  throw new Error("DATA_OVERLAP_DAYS must be an integer between 1 and 14");
}
const SELECTED_MARKETS = MARKET_FILTER ? MARKETS.filter(market => market.prefix.toUpperCase() === MARKET_FILTER) : MARKETS;
if (MARKET_FILTER && SELECTED_MARKETS.length === 0) throw new Error("Unknown MARKET_FILTER: " + MARKET_FILTER);

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function candleTimestamp(candle) {
  const raw = candle.timestamp ?? candle.time ?? candle.date;
  const value = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : Date.parse(raw);
  if (!Number.isFinite(value)) return NaN;
  return value < 1e12 ? value * 1000 : value;
}

function validCandle(candle) {
  const timestamp = candleTimestamp(candle);
  const open = Number(candle.open), high = Number(candle.high);
  const low = Number(candle.low), close = Number(candle.close);
  return Number.isFinite(timestamp) &&
    [open, high, low, close].every(Number.isFinite) &&
    high >= Math.max(open, close, low) &&
    low <= Math.min(open, close, high);
}

async function readCachedCandles(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("cached candle file is not an array");
    return parsed.filter(validCandle);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error("Cannot read cached candles at " + path + ": " + error.message);
  }
}

function mergeCandles(previous, incoming, cutoff) {
  const byTimestamp = new Map();
  for (const candle of [...previous, ...incoming]) {
    if (!validCandle(candle)) continue;
    const timestamp = candleTimestamp(candle);
    if (timestamp < cutoff) continue;
    byTimestamp.set(timestamp, { ...candle, timestamp, source: candle.source ?? "Dukascopy" });
  }
  return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
}

async function atomicWrite(path, data) {
  const temporary = path + ".tmp";
  await writeFile(temporary, JSON.stringify(data));
  await rename(temporary, path);
}


const TWELVE_DATA_INTERVALS = { m5: 5, m15: 15, h1: 60, h4: 240 };
const TWELVE_DATA_SYMBOLS = { eurusd: "EUR/USD", xauusd: "XAU/USD" };
const TWELVE_DATA_M5_CACHE = new Map();

function parseTwelveDataDate(value) {
  if (typeof value !== "string") return NaN;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : normalized + "Z";
  return Date.parse(withZone);
}

async function downloadTwelveDataM5(market) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  const symbol = TWELVE_DATA_SYMBOLS[market.prefix];
  if (!apiKey || !symbol) return null;
  if (TWELVE_DATA_M5_CACHE.has(market.prefix)) return TWELVE_DATA_M5_CACHE.get(market.prefix);
  const request = (async () => {
    const url = new URL("https://api.twelvedata.com/time_series");
    url.search = new URLSearchParams({
      symbol,
      interval: "5min",
      outputsize: "5000",
      order: "ASC",
      timezone: "UTC",
      format: "JSON",
      apikey: apiKey
    }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error("Twelve Data HTTP " + response.status);
    const payload = await response.json();
    if (payload.status === "error" || payload.code || !Array.isArray(payload.values)) {
      throw new Error("Twelve Data response: " + (payload.message ?? payload.code ?? "no candle values"));
    }
    const candles = payload.values.map(row => ({
      timestamp: parseTwelveDataDate(row.datetime),
      open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close),
      volume: Number(row.volume ?? 0), source: "Twelve Data " + symbol
    })).filter(validCandle).sort((a, b) => a.timestamp - b.timestamp);
    if (candles.length < 100) throw new Error("Twelve Data returned only " + candles.length + " valid M5 candles for " + symbol);
    return candles;
  })();
  TWELVE_DATA_M5_CACHE.set(market.prefix, request);
  try {
    return await request;
  } catch (error) {
    TWELVE_DATA_M5_CACHE.delete(market.prefix);
    throw error;
  }
}

function resampleFiveMinuteCandles(candles, timeframe) {
  const minutes = TWELVE_DATA_INTERVALS[timeframe];
  if (!minutes || minutes === 5) return candles;
  const expected = minutes / 5;
  const duration = minutes * 60_000;
  const groups = new Map();
  for (const candle of candles) {
    const bucket = Math.floor(candle.timestamp / duration) * duration;
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(candle);
  }
  const output = [];
  for (const [timestamp, rows] of groups) {
    rows.sort((a, b) => a.timestamp - b.timestamp);
    if (rows.length !== expected) continue;
    if (rows.some((row, index) => row.timestamp !== timestamp + index * 5 * 60_000)) continue;
    output.push({
      timestamp,
      open: rows[0].open,
      high: Math.max(...rows.map(row => row.high)),
      low: Math.min(...rows.map(row => row.low)),
      close: rows.at(-1).close,
      volume: rows.reduce((sum, row) => sum + (Number(row.volume) || 0), 0),
      source: "Twelve Data resampled from M5"
    });
  }
  return output;
}

const KRAKEN_INTERVALS = { m5: 5, m15: 15, h1: 60, h4: 240 };

async function downloadKrakenCandles(timeframe) {
  const interval = KRAKEN_INTERVALS[timeframe];
  if (!interval) throw new Error("Unsupported Kraken interval: " + timeframe);
  const url = new URL("https://api.kraken.com/0/public/OHLC");
  url.search = new URLSearchParams({ pair: "XBTUSD", interval: String(interval) }).toString();
  let payload, lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error("Kraken HTTP " + response.status);
      payload = await response.json();
      if (payload.error?.length) throw new Error("Kraken API: " + payload.error.join(", "));
      break;
    } catch (error) {
      lastError = error;
      if (attempt === 3) throw lastError;
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
  const result = payload?.result ?? {};
  const pairKey = Object.keys(result).find(key => key !== "last");
  const rows = pairKey ? result[pairKey] : null;
  if (!Array.isArray(rows)) throw new Error("Kraken returned no XBT/USD OHLC rows");
  return rows.map(row => ({
    timestamp: Number(row[0]) * 1000,
    open: Number(row[1]), high: Number(row[2]), low: Number(row[3]),
    close: Number(row[4]), volume: Number(row[6]), source: "Kraken XBT/USD spot"
  }));
}

async function fetchDukascopyHistory(market, timeframe, from, to) {
  // Dukascopy's FX/metals responses are capped near 5,000 bars per request.
  // Chunk by timeframe so a 180-day training window is actually complete.
  const chunkDays = market.prefix === "btcusd" ? 200 : ({ m5: 16, m15: 50, h1: 180, h4: 180 }[timeframe] ?? 30);
  const start = new Date(from + "T00:00:00.000Z");
  const end = new Date(to);
  const output = [];
  for (let cursor = start; cursor < end;) {
    const next = new Date(Math.min(end.getTime(), cursor.getTime() + chunkDays * 86_400_000));
    const chunkFrom = formatDate(cursor);
    const chunkTo = next.toISOString();
    console.log(`Dukascopy chunk ${market.label} ${timeframe.toUpperCase()}: ${chunkFrom} → ${chunkTo.slice(0, 10)}`);
    const rows = await getHistoricalRates({
      instrument: market.instrument,
      dates: { from: chunkFrom, to: chunkTo },
      timeframe,
      format: "json",
      volumes: true,
      useCache: true,
      batchSize: Number(process.env.DUKASCOPY_BATCH_SIZE ?? 6),
      pauseBetweenBatchesMs: Number(process.env.DUKASCOPY_BATCH_PAUSE_MS ?? 500),
      requestIntervalMs: Number(process.env.DUKASCOPY_REQUEST_INTERVAL_MS ?? 150),
      retryCount: Number(process.env.DUKASCOPY_RETRY_COUNT ?? 3),
      pauseBetweenRetriesMs: Number(process.env.DUKASCOPY_RETRY_PAUSE_MS ?? 1500),
      rateLimitRetryCount: Number(process.env.DUKASCOPY_RATE_LIMIT_RETRIES ?? 5)
    });
    if (Array.isArray(rows)) output.push(...rows);
    cursor = next;
  }
  return output;
}

async function downloadOne(market, timeframe) {
  const now = new Date();
  const cutoff = now.getTime() - DAYS_BACK * 86_400_000;
  const useKraken = market.prefix === "btcusd" &&
    (process.env.BTC_DATA_PREFIX ?? "btcusd").toLowerCase() === "kraken-btcusd";
  const prefix = useKraken ? "kraken-btcusd" : market.prefix;
  const path = `${DATA_DIR}/${prefix}-${timeframe}.json`;
  const previous = await readCachedCandles(path);
  const latestCached = previous.reduce((latest, candle) => Math.max(latest, candleTimestamp(candle)), 0);
  const earliestAllowed = new Date(cutoff);
  const incrementalFrom = latestCached
    ? new Date(Math.max(cutoff, latestCached - OVERLAP_DAYS * 86_400_000))
    : earliestAllowed;
  const from = formatDate(incrementalFrom);
  const to = now.toISOString();

  console.log(`Downloading ${market.label} ${timeframe.toUpperCase()} candles from ${from} (cache: ${previous.length} rows; overlap: ${latestCached ? OVERLAP_DAYS + " days" : "cold start"})...`);
  let incoming;
  let provider = useKraken ? "Kraken" : "Dukascopy";
  if (useKraken) {
    incoming = await downloadKrakenCandles(timeframe);
  } else if (process.env.TWELVE_DATA_API_KEY && TWELVE_DATA_SYMBOLS[market.prefix]) {
    try {
      const freshM5 = await downloadTwelveDataM5(market);
      incoming = timeframe === "m5" ? freshM5 : resampleFiveMinuteCandles(freshM5, timeframe);
      provider = "Twelve Data";
      if (!incoming.length) throw new Error("No complete " + timeframe.toUpperCase() + " bars could be resampled from Twelve Data M5");
    } catch (error) {
      console.warn(market.label + " " + timeframe.toUpperCase() + ": Twelve Data unavailable; using Dukascopy fallback. Reason: " + error.message);
      provider = "Dukascopy fallback";
      incoming = await fetchDukascopyHistory(market, timeframe, from, to);
    }
  } else {
    incoming = await fetchDukascopyHistory(market, timeframe, from, to);
  }

  if (!Array.isArray(incoming) || incoming.length < 1) {
    throw new Error(`No new ${market.label} ${timeframe.toUpperCase()} candles returned`);
  }
  let merged = mergeCandles(previous, incoming, cutoff);
  if (provider === "Twelve Data") {
    console.warn(market.label + " " + timeframe.toUpperCase() + ": Twelve Data history is too short for a cold start; supplementing from Dukascopy.");
    const fallback = await fetchDukascopyHistory(market, timeframe, from, to);
    merged = mergeCandles(merged, fallback, cutoff);
    provider = "Twelve Data + Dukascopy history";
  }
  if (merged.length < 100) {
    throw new Error(`Not enough merged ${market.label} ${timeframe.toUpperCase()} candles: ${merged.length}`);
  }
  await atomicWrite(path, merged);
  console.log(`${market.label} ${timeframe.toUpperCase()}: fetched ${incoming.length}, merged ${merged.length}, added/updated ${Math.max(0, merged.length - previous.length)}; saved ${path}${useKraken ? " (Kraken XBT/USD spot; provider returns a rolling window)" : " (Dukascopy)"}.`);
}

async function runWithConcurrency(tasks, concurrency) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= tasks.length) return;
      await tasks[index]();
    }
  });
  await Promise.all(workers);
}

async function main() {
  if (!Number.isInteger(DAYS_BACK) || DAYS_BACK < 30 || DAYS_BACK > 730) {
    throw new Error("DATA_DAYS_BACK must be an integer between 30 and 730");
  }
  await mkdir(DATA_DIR, { recursive: true });
  const tasks = SELECTED_MARKETS.flatMap(market => TIMEFRAMES.map(timeframe => () => downloadOne(market, timeframe)));
  const startedAt = Date.now();
  console.log("Incremental candle refresh: reuse cached history, fetch a recent overlapping window, deduplicate by timestamp.");
  console.log("Starting " + tasks.length + " candle refreshes with concurrency " + DOWNLOAD_CONCURRENCY + ".");
  await runWithConcurrency(tasks, DOWNLOAD_CONCURRENCY);
  console.log("Selected market datasets refreshed:", SELECTED_MARKETS.map(market => market.label).join(", "));
  console.log("Total candle refresh time: " + ((Date.now() - startedAt) / 1000).toFixed(1) + " seconds.");
}

main().catch(error => {
  console.error("Market data refresh failed:", error);
  process.exitCode = 1;
});
