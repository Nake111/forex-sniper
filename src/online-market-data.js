import { mkdir, readFile, writeFile } from "node:fs/promises";

const BASE = "https://data-api.binance.vision/api/v3";
const SYMBOL = "BTCUSDT";
const WINDOWS = [
  { interval: "5m", file: "data/online-btcusdt-m5.json", days: 14, keep: 20000 },
  { interval: "15m", file: "data/online-btcusdt-m15.json", days: 30, keep: 10000 },
  { interval: "1h", file: "data/online-btcusdt-h1.json", days: 90, keep: 5000 }
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function requestJson(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "forex-sniper-market-data/1.0" },
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 250)}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      console.warn(`Request attempt ${attempt}/${attempts} failed: ${error.message}`);
      if (attempt < attempts) await sleep(attempt * 1500);
    }
  }
  throw lastError;
}

function normalizeKline(row) {
  return {
    timestamp: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    closeTime: Number(row[6]),
    quoteVolume: Number(row[7]),
    trades: Number(row[8]),
    takerBuyBaseVolume: Number(row[9]),
    takerBuyQuoteVolume: Number(row[10]),
    source: "Binance Spot BTCUSDT"
  };
}

async function loadExisting(file) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function syncInterval(config, now) {
  const existing = await loadExisting(config.file);
  const intervalMs = config.interval === "5m" ? 300000 :
    config.interval === "15m" ? 900000 : 3600000;
  const bootstrapStart = now - config.days * 86400000;
  const lastTime = existing.reduce((max, candle) =>
    Math.max(max, Number(candle.timestamp) || 0), 0);
  const startAt = lastTime ? Math.max(bootstrapStart, lastTime + intervalMs) : bootstrapStart;
  const endAt = now - 1;
  const fresh = [];

  for (let cursor = startAt; cursor <= endAt;) {
    const url = new URL(BASE + "/klines");
    url.searchParams.set("symbol", SYMBOL);
    url.searchParams.set("interval", config.interval);
    url.searchParams.set("startTime", String(cursor));
    url.searchParams.set("endTime", String(endAt));
    url.searchParams.set("limit", "1000");
    const rows = await requestJson(url);
    if (!Array.isArray(rows) || rows.length === 0) break;
    const batch = rows.map(normalizeKline).filter(c => c.closeTime < now);
    fresh.push(...batch);
    const next = Number(rows.at(-1)[0]) + intervalMs;
    if (next <= cursor) throw new Error("Kline pagination did not advance");
    cursor = next;
    if (rows.length < 1000) break;
    await sleep(120);
  }

  const byTime = new Map();
  for (const candle of [...existing, ...fresh]) {
    if (Number.isFinite(candle.timestamp) && candle.closeTime < now) {
      byTime.set(candle.timestamp, candle);
    }
  }
  const merged = [...byTime.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-config.keep);

  if (merged.length < 220) {
    throw new Error(`${config.interval}: only ${merged.length} closed candles; need at least 220`);
  }
  await writeFile(config.file, JSON.stringify(merged) + "\n");
  console.log(`${config.interval}: ${merged.length} closed candles; added ${fresh.length}; latest ${new Date(merged.at(-1).timestamp).toISOString()}`);
  return merged.at(-1);
}

async function main() {
  await mkdir("data", { recursive: true });
  const now = Date.now();
  const latest = {};
  for (const config of WINDOWS) {
    latest[config.interval] = await syncInterval(config, now);
  }

  const [price, ticker24h, book, coinbase] = await Promise.all([
    requestJson(BASE + "/ticker/price?symbol=" + SYMBOL),
    requestJson(BASE + "/ticker/24hr?symbol=" + SYMBOL),
    requestJson(BASE + "/ticker/bookTicker?symbol=" + SYMBOL),
    requestJson("https://api.exchange.coinbase.com/products/BTC-USD/ticker").catch(error => {
      console.warn("Coinbase cross-check unavailable:", error.message);
      return null;
    })
  ]);

  const record = {
    schemaVersion: 1,
    symbol: "BTCUSDT",
    instrumentType: "spot",
    generatedAt: new Date().toISOString(),
    source: "Binance Spot public market-data API",
    sourceUrl: "https://data-api.binance.vision",
    referenceOnly: "BTCUSDT spot is a market proxy, not Vantage BTCUSD CFD pricing",
    lastPrice: Number(price.price),
    bid: Number(book.bidPrice),
    ask: Number(book.askPrice),
    bidQty: Number(book.bidQty),
    askQty: Number(book.askQty),
    spread: Number(book.askPrice) - Number(book.bidPrice),
    change24h: Number(ticker24h.priceChange),
    changePercent24h: Number(ticker24h.priceChangePercent),
    high24h: Number(ticker24h.highPrice),
    low24h: Number(ticker24h.lowPrice),
    baseVolume24h: Number(ticker24h.volume),
    quoteVolume24h: Number(ticker24h.quoteVolume),
    trades24h: Number(ticker24h.count),
    coinbaseBtcUsd: coinbase ? {
      price: Number(coinbase.price),
      bid: Number(coinbase.bid),
      ask: Number(coinbase.ask),
      time: coinbase.time
    } : null,
    candleLastTimes: Object.fromEntries(
      Object.entries(latest).map(([tf, candle]) => [tf, new Date(candle.timestamp).toISOString()])
    )
  };
  await writeFile("data/online-market.json", JSON.stringify(record, null, 2) + "\n");
  console.log("Online market snapshot saved: data/online-market.json");
  console.log("BTCUSDT spot:", record.lastPrice, "24h change:", record.changePercent24h + "%");
}

main().catch(error => {
  console.error("Online market-data sync failed:", error);
  process.exitCode = 1;
});
