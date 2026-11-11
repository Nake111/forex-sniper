import http from "node:http";
import WebSocket from "ws";
import { HubConnectionBuilder, LogLevel } from "@microsoft/signalr";
import { normalizeCoinbaseTicker, normalizeBiquoteStreamTick } from "./realtime-feed-core.js";
import { validateBiquoteTick } from "./biquote-quotes.js";

const PORT = Number(process.env.PORT ?? 8080);
const MAX_AGE_MS = 15_000;
const COINBASE_STREAM = "wss://ws-feed.exchange.coinbase.com";
const BIQUOTE_HUB = "https://biquote.io/hubs/tick";
const quotes = {};
const clients = new Set();
let socket, reconnectTimer, reconnectAttempt = 0, stopping = false, biquoteConnection;

function publish(market, quote) {
  quotes[market] = quote;
  const event = "event: quote\ndata: " + JSON.stringify({ market, quote, updatedAt: Date.now() }) + "\n\n";
  for (const client of clients) client.write(event);
}

function connectCoinbase() {
  if (stopping) return;
  socket = new WebSocket(COINBASE_STREAM, { handshakeTimeout: 10_000 });
  socket.on("open", () => {
    reconnectAttempt = 0;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    socket.send(JSON.stringify({ type: "subscribe", product_ids: ["BTC-USD"], channels: ["ticker"] }));
    console.log("Coinbase BTC-USD ticker WebSocket connected.");
  });
  socket.on("message", raw => {
    try {
      const quote = normalizeCoinbaseTicker(JSON.parse(raw.toString()));
      if (quote) publish("BTCUSD", quote);
    } catch (error) { console.error("Ignored malformed Coinbase message:", error.message); }
  });
  socket.on("error", error => console.error("Coinbase WebSocket error:", error.message));
  socket.on("close", () => {
    if (stopping || reconnectTimer) return;
    const delay = Math.min(1_000 * (2 ** reconnectAttempt++), 30_000);
    console.warn("Coinbase WebSocket disconnected; reconnecting in", delay, "ms");
    reconnectTimer = setTimeout(() => { reconnectTimer = undefined; connectCoinbase(); }, delay);
  });
}

async function connectBiquote() {
  if (stopping) return;
  try {
    biquoteConnection = new HubConnectionBuilder()
      .withUrl(BIQUOTE_HUB, { WebSocket })
      .withAutomaticReconnect([0, 2_000, 5_000, 10_000, 30_000])
      .configureLogging(LogLevel.Warning)
      .build();
    biquoteConnection.on("ReceiveTick", payload => {
      const records = Array.isArray(payload) ? payload : [payload];
      for (const record of records) {
        const quote = normalizeBiquoteStreamTick(record);
        if (!quote) continue;
        const validation = validateBiquoteTick(quote, { maxAgeMs: MAX_AGE_MS });
        if (validation.valid) publish(quote.market, quote);
      }
    });
    biquoteConnection.onreconnected(async () => {
      console.log("Biquote SignalR reconnected; resubscribing.");
      await biquoteConnection.invoke("Subscribe", ["EURUSD", "XAUUSD"]);
    });
    await biquoteConnection.start();
    await biquoteConnection.invoke("Subscribe", ["EURUSD", "XAUUSD"]);
    console.log("Biquote EURUSD/XAUUSD SignalR stream connected.");
  } catch (error) {
    console.error("Biquote SignalR connection failed:", error.message);
    if (!stopping) setTimeout(() => void connectBiquote(), 10_000);
  }
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
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ service: "forex-sniper-realtime-feed", status: healthy ? "LIVE" : "PARTIAL", ready: healthy, cadenceMs: "provider-push", markets, updatedAt: Date.now() }));
    return;
  }
  if (url.pathname === "/ready") {
    const ready = ["EURUSD", "BTCUSD", "XAUUSD"].every(market => marketStatus(market).status === "FRESH");
    response.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify({ ready, markets: Object.fromEntries(["EURUSD", "BTCUSD", "XAUUSD"].map(market => [market, marketStatus(market)])) }));
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
connectCoinbase();
void connectBiquote();

function shutdown() {
  stopping = true;
  clearTimeout(reconnectTimer);
  socket?.close(1000, "service shutdown");
  void biquoteConnection?.stop();
  for (const client of clients) client.end();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
