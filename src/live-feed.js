import WebSocket from "ws";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

const SYMBOL = "BTCUSDT";
const STREAM_URL = "wss://stream.binance.com:9443/ws/btcusdt@kline_1m";
const TRADE_STREAM_URL = "wss://stream.binance.com:9443/ws/btcusdt@trade";
const DATA_DIR = "data";
const MAX_1M_CANDLES = 20_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const TIMEFRAMES = [
  { name: "m5", minutes: 5 },
  { name: "m15", minutes: 15 },
  { name: "h1", minutes: 60 },
  { name: "h4", minutes: 240 }
];

let candles = [];
let stopping = false;
let socket;
let tradeSocket;
let tradeReconnectTimer;
let tradeReconnectAttempt = 0;
let reconnectAttempt = 0;
let heartbeatTimer;
let reconnectTimer;

function normalizeKline(k) {
  return {
    timestamp: Number(k.t),
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume: Number(k.v),
    trades: Number(k.n),
    source: "Binance spot BTCUSDT"
  };
}

function validCandle(c) {
  return [c.timestamp, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) &&
    c.high >= Math.max(c.open, c.close, c.low) &&
    c.low <= Math.min(c.open, c.close, c.high) &&
    c.volume >= 0;
}

async function bootstrap() {
  // Seed 15,000 closed 1m bars so the 60-bar H4 minimum is met too.
  const now = Date.now();
  let cursor = now - 15_000 * 60_000;
  const seeded = [];
  for (let page = 0; page < 15; page++) {
    const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1000&startTime=${cursor}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Binance history request failed: HTTP ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      seeded.push({
        timestamp: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
        trades: Number(row[8]),
        source: "Binance spot BTCUSDT"
      });
    }
    cursor = Number(rows.at(-1)[0]) + 60_000;
    if (rows.length < 1000 || cursor >= now) break;
  }
  candles = seeded.filter(c => validCandle(c) && c.timestamp + 60_000 <= now)
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter((c, i, all) => i === 0 || c.timestamp !== all[i - 1].timestamp)
    .slice(-MAX_1M_CANDLES);
  await persistTimeframes();
  console.log(`Bootstrapped ${candles.length} closed 1-minute BTCUSDT candles from Binance.`);
}
function aggregate(minutes) {
  const buckets = new Map();
  for (const candle of candles) {
    const bucket = Math.floor(candle.timestamp / (minutes * 60_000)) * minutes * 60_000;
    const existing = buckets.get(bucket);
    if (!existing) {
      buckets.set(bucket, {
        timestamp: bucket,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        trades: candle.trades ?? 0,
        source: "Binance spot BTCUSDT"
      });
    } else {
      existing.high = Math.max(existing.high, candle.high);
      existing.low = Math.min(existing.low, candle.low);
      existing.close = candle.close;
      existing.volume += candle.volume;
      existing.trades += candle.trades ?? 0;
    }
  }
  const now = Date.now();
  return [...buckets.values()]
    .filter(c => c.timestamp + minutes * 60_000 <= now)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-2_000);
}

async function atomicWrite(path, data) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(data));
  await rename(temporary, path);
}

async function persistTimeframes() {
  await mkdir(DATA_DIR, { recursive: true });
  for (const timeframe of TIMEFRAMES) {
    const result = aggregate(timeframe.minutes);
    await atomicWrite(`${DATA_DIR}/btcusd-${timeframe.name}.json`, result);
  }
}

function acceptKline(message) {
  const payload = JSON.parse(message.toString());
  if (payload.e !== "kline" || payload.s !== SYMBOL || !payload.k?.x) return;
  const candle = normalizeKline(payload.k);
  if (!validCandle(candle)) return;

  const existingIndex = candles.findIndex(item => item.timestamp === candle.timestamp);
  if (existingIndex >= 0) candles[existingIndex] = candle;
  else candles.push(candle);
  candles.sort((a, b) => a.timestamp - b.timestamp);
  candles = candles.slice(-MAX_1M_CANDLES);

  persistTimeframes().then(() => {
    console.log(`CLOSED BTCUSDT M1 | ${new Date(candle.timestamp).toISOString()} | close=${candle.close} | volume=${candle.volume}`);
  }).catch(error => console.error("Persist error:", error.message));
}

async function persistBtcTradeTick(payload) {
  const price = Number(payload.p);
  const timestamp = Number(payload.T);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(timestamp)) return;
  const record = {
    symbol: "BTCUSD",
    price,
    timestamp,
    receivedAt: Date.now(),
    source: "Binance spot BTCUSDT trade stream (BTC/USD proxy; not broker CFD)"
  };
  const directory = "data/live-ticks";
  await mkdir(directory, { recursive: true });
  const path = directory + "/BTCUSD.json";
  const temporary = path + ".tmp";
  await writeFile(temporary, JSON.stringify(record));
  await rename(temporary, path);
  console.log("BTC LIVE TRADE TICK:", JSON.stringify({ ...record, ageAtWriteMs: Date.now() - record.receivedAt }));
}

function connectTradeStream() {
  if (stopping) return;
  console.log("Connecting to Binance BTCUSDT trade stream for live tick snapshots...");
  tradeSocket = new WebSocket(TRADE_STREAM_URL, { handshakeTimeout: 15_000 });
  tradeSocket.on("open", () => {
    tradeReconnectAttempt = 0;
    clearTimeout(tradeReconnectTimer);
    tradeReconnectTimer = undefined;
    console.log("BTC trade stream connected. Tick snapshots are reference spot prices, not broker CFD quotes.");
  });
  tradeSocket.on("message", raw => {
    let payload;
    try { payload = JSON.parse(raw.toString()); } catch { return; }
    if (payload.e !== "trade" || payload.s !== SYMBOL) return;
    void persistBtcTradeTick(payload).catch(error => console.error("BTC tick persistence error:", error.message));
  });
  tradeSocket.on("error", error => console.error("BTC trade stream error:", error.message));
  tradeSocket.on("close", (code, reason) => {
    if (stopping) return;
    const delay = Math.min(RECONNECT_BASE_MS * (2 ** tradeReconnectAttempt), RECONNECT_MAX_MS);
    tradeReconnectAttempt += 1;
    console.error(`BTC trade stream closed (${code}: ${reason.toString()}). Reconnecting in ${delay}ms.`);
    clearTimeout(tradeReconnectTimer);
    tradeReconnectTimer = setTimeout(() => {
      tradeReconnectTimer = undefined;
      connectTradeStream();
    }, delay);
  });
}

function connect() {
  if (stopping) return;
  console.log("Connecting to Binance public BTCUSDT 1m WebSocket...");
  socket = new WebSocket(STREAM_URL, { handshakeTimeout: 15_000 });

  socket.on("open", () => {
    reconnectAttempt = 0;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    console.log("BTCUSDT WebSocket connected. Live feed is read-only; no orders are sent.");
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) socket.ping();
    }, 20_000);
  });

  socket.on("message", acceptKline);
  socket.on("pong", () => {});
  socket.on("error", error => console.error("WebSocket error:", error.message));
  socket.on("close", (code, reason) => {
    clearInterval(heartbeatTimer);
    if (stopping) return;
    const delay = Math.min(RECONNECT_BASE_MS * (2 ** reconnectAttempt), RECONNECT_MAX_MS);
    reconnectAttempt += 1;
    console.error(`WebSocket closed (${code}: ${reason.toString()}). Reconnecting in ${delay}ms.`);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, delay);
  });
}

async function shutdown() {
  stopping = true;
  clearInterval(heartbeatTimer);
  clearTimeout(reconnectTimer);
  clearTimeout(tradeReconnectTimer);
  reconnectTimer = undefined;
  tradeReconnectTimer = undefined;
  if (tradeSocket && tradeSocket.readyState < WebSocket.CLOSING) tradeSocket.close(1000, "Service shutdown");
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Service shutdown");
  await persistTimeframes().catch(error => console.error("Final persistence error:", error.message));
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await bootstrap();
  connect();
  connectTradeStream();
} catch (error) {
  console.error("Live feed startup failed:", error);
  process.exitCode = 1;
}
