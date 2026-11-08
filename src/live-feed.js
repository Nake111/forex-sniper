import WebSocket from "ws";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

const SYMBOL = "BTCUSDT";
const STREAM_URL = "wss://stream.binance.com:9443/ws/btcusdt@kline_1m";
const DATA_DIR = "data";
const MAX_1M_CANDLES = 10_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const TIMEFRAMES = [
  { name: "m5", minutes: 5 },
  { name: "m15", minutes: 15 },
  { name: "h1", minutes: 60 }
];

let candles = [];
let stopping = false;
let socket;
let reconnectAttempt = 0;
let heartbeatTimer;

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
  // Seed recent history so the service can build useful M5/M15/H1 context immediately.
  const url = "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1000";
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Binance history request failed: HTTP ${response.status}`);
  const rows = await response.json();
  const now = Date.now();
  candles = rows.map(row => ({
    timestamp: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    trades: Number(row[8]),
    source: "Binance spot BTCUSDT"
  })).filter(c => validCandle(c) && c.timestamp + 60_000 <= now).slice(-MAX_1M_CANDLES);
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
    await atomicWrite(`${DATA_DIR}/btcusdt-${timeframe.name}.json`, result);
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

function connect() {
  if (stopping) return;
  console.log("Connecting to Binance public BTCUSDT 1m WebSocket...");
  socket = new WebSocket(STREAM_URL, { handshakeTimeout: 15_000 });

  socket.on("open", () => {
    reconnectAttempt = 0;
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
    setTimeout(connect, delay).unref();
  });
}

async function shutdown() {
  stopping = true;
  clearInterval(heartbeatTimer);
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Service shutdown");
  await persistTimeframes().catch(error => console.error("Final persistence error:", error.message));
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await bootstrap();
  connect();
} catch (error) {
  console.error("Live feed startup failed:", error);
  process.exitCode = 1;
}
