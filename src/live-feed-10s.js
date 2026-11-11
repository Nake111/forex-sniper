import WebSocket from "ws";
import { createServer } from "node:http";

const SYMBOL = "BTC-USD";
const STREAM_URL = "wss://advanced-trade-ws.coinbase.com";
const BUCKET_MS = 10_000;
const MAX_CANDLES = 500;
const PORT = Number(process.env.PORT ?? 8080);
const STALE_AFTER_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

let current = null;
let candles = [];
let lastTradeAt = null;
let socket = null;
let stopping = false;
let reconnectAttempt = 0;
let reconnectTimer = null;
let heartbeatTimer = null;
let gapCount = 0;
let lastClosedBucket = null;

function validTrade(price, quantity, timestamp) {
  return Number.isFinite(price) && price > 0 &&
    Number.isFinite(quantity) && quantity >= 0 &&
    Number.isFinite(timestamp) && timestamp > 0;
}

function closeCurrent() {
  if (!current) return;
  const candle = { ...current, closedAt: Date.now(), source: "Coinbase spot BTC-USD market trades", intervalSeconds: 10 };
  if (lastClosedBucket !== null && candle.timestamp > lastClosedBucket + BUCKET_MS) {
    candle.gapBefore = true;
    gapCount += Math.max(1, Math.floor((candle.timestamp - lastClosedBucket) / BUCKET_MS) - 1);
  }
  lastClosedBucket = candle.timestamp;
  candles.push(candle);
  candles = candles.slice(-MAX_CANDLES);
  console.log(`CLOSED BTC-USD 10s | ${new Date(candle.timestamp).toISOString()} | O=${candle.open} H=${candle.high} L=${candle.low} C=${candle.close} | trades=${candle.trades}`);
  current = null;
}

function acceptTrade(raw) {
  let payload;
  try { payload = JSON.parse(raw.toString()); } catch { return; }
  if (payload.channel !== "market_trades" || !Array.isArray(payload.events)) return;
  for (const event of payload.events) {
    for (const trade of (event.trades ?? [])) {
      if (trade.product_id !== SYMBOL) continue;
      const price = Number(trade.price);
      const quantity = Number(trade.size);
      const timestamp = Date.parse(trade.time);
      processTrade(price, quantity, timestamp);
    }
  }
  return;
}

function processTrade(price, quantity, timestamp) {
  
  if (!validTrade(price, quantity, timestamp)) return;

  const bucket = Math.floor(timestamp / BUCKET_MS) * BUCKET_MS;
  if (current && bucket < current.timestamp) return;
  if (current && bucket > current.timestamp) closeCurrent();

  if (!current) {
    current = { timestamp: bucket, open: price, high: price, low: price, close: price, volume: quantity, trades: 1 };
  } else {
    current.high = Math.max(current.high, price);
    current.low = Math.min(current.low, price);
    current.close = price;
    current.volume += quantity;
    current.trades += 1;
  }
  lastTradeAt = Date.now();
}

function connect() {
  if (stopping) return;
  console.log("Connecting to Coinbase BTC-USD public trade stream...");
  socket = new WebSocket(STREAM_URL, { handshakeTimeout: 15_000 });

  socket.on("open", () => {
    socket.send(JSON.stringify({
      type: "subscribe",
      product_ids: [SYMBOL],
      channel: "market_trades"
    }));
    reconnectAttempt = 0;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    console.log("BTC-USD trade stream connected. Read-only; no orders are sent.");
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) socket.ping();
    }, 20_000);
  });
  socket.on("message", acceptTrade);
  socket.on("error", error => console.error("WebSocket error:", error.message));
  socket.on("close", (code, reason) => {
    clearInterval(heartbeatTimer);
    if (stopping) return;
    const delay = Math.min(RECONNECT_BASE_MS * (2 ** reconnectAttempt), RECONNECT_MAX_MS);
    reconnectAttempt += 1;
    console.error(`WebSocket closed (${code}: ${reason.toString()}); reconnecting in ${delay}ms.`);
    reconnectTimer = setTimeout(connect, delay);
  });
}

const server = createServer((req, res) => {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("access-control-allow-origin", "*");
  if (req.url === "/health") {
    const ageMs = lastTradeAt === null ? null : Date.now() - lastTradeAt;
    const healthy = socket?.readyState === WebSocket.OPEN && ageMs !== null && ageMs <= STALE_AFTER_MS;
    res.statusCode = healthy ? 200 : 503;
    res.end(JSON.stringify({ status: healthy ? "live" : "stale_or_connecting", symbol: SYMBOL, intervalSeconds: 10, source: "Coinbase spot BTC-USD trades", lastTradeAt, ageMs, candles: candles.length, gapCount }));
    return;
  }
  if (req.url === "/latest") {
    const ageMs = lastTradeAt === null ? null : Date.now() - lastTradeAt;
    res.end(JSON.stringify({ symbol: SYMBOL, intervalSeconds: 10, source: "Coinbase spot BTC-USD trades", status: ageMs !== null && ageMs <= STALE_AFTER_MS ? "live" : "stale", lastTradeAt, ageMs, current, candles: candles.slice(-200), gapCount }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "Use /health or /latest" }));
});

server.listen(PORT, "0.0.0.0", () => console.log(`10-second BTC feed API listening on port ${PORT}`));

const bucketTimer = setInterval(() => {
  if (current && Date.now() >= current.timestamp + BUCKET_MS) closeCurrent();
}, 250);

function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(bucketTimer);
  clearInterval(heartbeatTimer);
  clearTimeout(reconnectTimer);
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Service shutdown");
  closeCurrent();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("uncaughtException", error => { console.error("Fatal error:", error); shutdown(); });
process.on("unhandledRejection", error => { console.error("Unhandled rejection:", error); shutdown(); });

connect();
