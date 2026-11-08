import { getHistoricalRates } from "dukascopy-node";
import { mkdir, writeFile } from "node:fs/promises";

const DAYS_BACK = Number(process.env.DATA_DAYS_BACK ?? 180);
const MARKETS = [
  { label: "EUR/USD", instrument: "eurusd", prefix: "eurusd" },
  { label: "BTC/USD", instrument: "btcusd", prefix: "btcusd" },
  { label: "Gold XAU/USD", instrument: "xauusd", prefix: "xauusd" }
];
const TIMEFRAMES = ["m5", "m15", "h1", "h4"];
const MARKET_FILTER = process.env.MARKET_FILTER?.toUpperCase();
const DOWNLOAD_CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.DOWNLOAD_CONCURRENCY ?? 3)));
const SELECTED_MARKETS = MARKET_FILTER ? MARKETS.filter(market => market.prefix.toUpperCase() === MARKET_FILTER) : MARKETS;
if (MARKET_FILTER && SELECTED_MARKETS.length === 0) throw new Error("Unknown MARKET_FILTER: " + MARKET_FILTER);

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

const BINANCE_INTERVALS = { m5: "5m", m15: "15m", h1: "1h", h4: "4h" };
const INTERVAL_MS = { m5: 5 * 60_000, m15: 15 * 60_000, h1: 60 * 60_000, h4: 4 * 60 * 60_000 };

async function downloadBinanceCandles(timeframe, from, to) {
  const interval = BINANCE_INTERVALS[timeframe];
  if (!interval) throw new Error("Unsupported Binance interval: " + timeframe);
  const step = INTERVAL_MS[timeframe];
  const candles = [];
  let startTime = from.getTime();
  const endTime = to.getTime();

  while (startTime < endTime) {
    const url = new URL("https://api.binance.com/api/v3/klines");
    url.search = new URLSearchParams({
      symbol: "BTCUSDT", interval, startTime: String(startTime),
      endTime: String(endTime), limit: "1000"
    }).toString();

    let rows;
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error("Binance HTTP " + response.status);
        rows = await response.json();
        if (!Array.isArray(rows)) throw new Error("Binance returned a non-array candle payload");
        break;
      } catch (error) {
        lastError = error;
        if (attempt === 3) throw lastError;
        await new Promise(resolve => setTimeout(resolve, attempt * 500));
      }
    }

    if (!rows.length) break;
    for (const row of rows) {
      candles.push({
        timestamp: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5])
      });
    }
    const nextStart = Number(rows.at(-1)[0]) + step;
    if (!Number.isFinite(nextStart) || nextStart <= startTime) {
      throw new Error("Binance candle pagination did not advance");
    }
    startTime = nextStart;
    if (rows.length < 1000) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return candles;
}

async function downloadOne(market, timeframe) {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - DAYS_BACK);

  console.log(`Downloading ${market.label} ${timeframe.toUpperCase()} candles...`);
  const useBinance = market.prefix === "btcusd" &&
    (process.env.BTC_DATA_PREFIX ?? "btcusd").toLowerCase() === "btcusdt";
  const candles = useBinance ? await downloadBinanceCandles(timeframe, from, to)
    : await getHistoricalRates({
      instrument: market.instrument,
      dates: { from: formatDate(from), to: formatDate(to) },
      timeframe,
      format: "json",
      volumes: true,
      useCache: true,
      batchSize: Number(process.env.DUKASCOPY_BATCH_SIZE ?? 3),
      pauseBetweenBatchesMs: Number(process.env.DUKASCOPY_BATCH_PAUSE_MS ?? 1500),
      requestIntervalMs: Number(process.env.DUKASCOPY_REQUEST_INTERVAL_MS ?? 250),
      retryCount: Number(process.env.DUKASCOPY_RETRY_COUNT ?? 3),
      pauseBetweenRetriesMs: Number(process.env.DUKASCOPY_RETRY_PAUSE_MS ?? 1500),
      rateLimitRetryCount: Number(process.env.DUKASCOPY_RATE_LIMIT_RETRIES ?? 5)
    });

  if (!Array.isArray(candles) || candles.length < 100) {
    throw new Error(`Not enough ${market.label} ${timeframe.toUpperCase()} candles: ${candles?.length ?? 0}`);
  }

  const prefix = useBinance ? "btcusdt" : market.prefix;
  const path = `data/${prefix}-${timeframe}.json`;
  await writeFile(path, JSON.stringify(candles));
  console.log(`${market.label} ${timeframe.toUpperCase()} ${useBinance ? "(Binance BTCUSDT spot proxy)" : "(Dukascopy)"}: ${candles.length} candles saved to ${path}`);
}

async function runWithConcurrency(tasks, concurrency) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= tasks.length) return;
      const task = tasks[index];
      await task();
    }
  });
  await Promise.all(workers);
}

async function main() {
  if (!Number.isInteger(DAYS_BACK) || DAYS_BACK < 30 || DAYS_BACK > 730) {
    throw new Error("DATA_DAYS_BACK must be an integer between 30 and 730");
  }
  await mkdir("data", { recursive: true });
  const tasks = SELECTED_MARKETS.flatMap(market => TIMEFRAMES.map(timeframe => () => downloadOne(market, timeframe)));
  const startedAt = Date.now();
  console.log("Starting " + tasks.length + " candle downloads with concurrency " + DOWNLOAD_CONCURRENCY + ".");
  await runWithConcurrency(tasks, DOWNLOAD_CONCURRENCY);
  console.log("Selected market datasets downloaded:", SELECTED_MARKETS.map(market => market.label).join(", "));
  console.log("Total candle download time: " + ((Date.now() - startedAt) / 1000).toFixed(1) + " seconds.");
}

main().catch(error => {
  console.error("Market data download failed:", error);
  process.exitCode = 1;
});
