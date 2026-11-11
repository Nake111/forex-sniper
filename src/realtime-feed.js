import http from "node:http";
import WebSocket from "ws";
import { fetchBiquoteQuote, validateBiquoteTick } from "./biquote-quotes.js";

const PORT = Number(process.env.PORT ?? 8080);
const POLL_MS = Math.max(1_000, Number(process.env.REALTIME_FX_POLL_MS ?? 2_000));
const MAX_AGE_MS = 15_000;
const BINANCE_STREAM = "wss://stream.binance.com:9443/ws/btcusdt@bookTicker";
const quotes = {};
const clients = new Set();
let socket, reconnectTimer, reconnectAttempt = 0, pollTimer, polling = false, stopping = false;

export function normalizeBinanceBookTicker(message, receivedAt = Date.now()) {
  if (String(message?.s ?? "").toUpperCase() !== "BTCUSDT") return null;
  const bid = Number(message.b), ask = Number(message.a);
  if (!(Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > bid)) return null;
  return {
    market: "BTCUSD", symbol: "BTC/USD", bid, ask, price: (bid + ask) / 2,
    timestamp: receivedAt, receivedAt, timestampQuality: "RECEIVED_AT_ONLY",
    source: "Binance spot bookTicker WebSocket", venue: "Binance", tradeable: true
  };
}

function publish(market, quote) {
  quotes[market] = quote;
  const event = "event: quote\ndata: " + JSON.stringify({ market, quote, updatedAt: Date.now() }) + "\n\n";
  for (const client of clients) client.write(event);
}

function connectBinance() {
  if (stopping) return;
  socket = new WebSocket(BINANCE_STREAM, { handshakeTimeout: 10_000 });
  socket.on("open", () => {
    reconnectAttempt = 0;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    console.log("Binance BTCUSDT bookTicker WebSocket connected.");
  });
  socket.on("message", raw => {
    try {
      const quote = normalizeBinanceBookTicker(JSON.parse(raw.toString()));
      if (quote) publish("BTCUSD", quote);
    } catch (error) { console.error("Ignored malformed Binance message:", error.message); }
  });
  socket.on("error", error => console.error("Binance WebSocket error:", error.message));
  socket.on("close", () => {
    if (stopping || reconnectTimer) return;
    const delay = Math.min(1_000 * (2 ** reconnectAttempt++), 30_000);
    console.warn("Binance WebSocket disconnected; reconnecting in", delay, "ms");
    reconnectTimer = setTimeout(() => { reconnectTimer = undefined; connectBinance(); }, delay);
  });
}

async function pollFxAndGold() {
  if (polling || stopping) return;
  polling = true;
  try {
    for (const market of ["EURUSD", "XAUUSD"]) {
      const result = await fetchBiquoteQuote(market, { timeoutMs: 4_000 });
      const validation = validateBiquoteTick(result.quote, { maxAgeMs: MAX_AGE_MS });
      if (validation.valid) publish(market, { ...result.quote, source: "Biquote MT5 aggregated quote polled every 2 seconds" });
      else console.warn(market + " quote unavailable/invalid:", result.error ?? validation.reason);
    }
  } finally { polling = false; }
}

function marketStatus(market) {
  const quote = quotes[market];
  if (!quote) return { status: "UNAVAILABLE", ageMs: null, source: null };
  const ageMs = Date.now() - quote.timestamp;
  return { status: ageMs >= 0 && ageMs <= MAX_AGE_MS ? "FRESH" : "STALE", ageMs, source: quote.source };
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/health" || url.pathname === "/") {
    const markets = Object.fromEntries(["EURUSD", "BTCUSD", "XAUUSD"].map(market => [market, marketStatus(market)]));
    const healthy = Object.values(markets).every(item => item.status === "FRESH");
    response.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify({ service: "forex-sniper-realtime-feed", status: healthy ? "LIVE" : "PARTIAL", cadenceMs: POLL_MS, markets, updatedAt: Date.now() }));
    return;
  }
  if (url.pathname === "/quotes") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ quotes, updatedAt: Date.now(), maxAgeMs: MAX_AGE_MS }));
    return;
  }
  if (url.pathname === "/stream") {
    response.writeHead(200, { "content-type": "text/event-stream", "connection": "keep-alive" });
    response.write("retry: 3000\n\n");
    clients.add(response);
    for (const [market, quote] of Object.entries(quotes)) response.write("event: quote\ndata: " + JSON.stringify({ market, quote, updatedAt: Date.now() }) + "\n\n");
    request.on("close", () => clients.delete(response));
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not_found" }));
});

server.listen(PORT, "0.0.0.0", () => console.log("Realtime quote feed listening on", PORT));
connectBinance();
void pollFxAndGold();
pollTimer = setInterval(() => void pollFxAndGold(), POLL_MS);

function shutdown() {
  stopping = true;
  clearInterval(pollTimer);
  clearTimeout(reconnectTimer);
  socket?.close(1000, "service shutdown");
  for (const client of clients) client.end();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
