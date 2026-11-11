import http from "node:http";
import WebSocket from "ws";
import { HubConnectionBuilder, HubConnectionState, LogLevel } from "@microsoft/signalr";
import { normalizeCoinbaseTicker, normalizeBiquoteStreamTick } from "./realtime-feed-core.js";
import { validateBiquoteTick } from "./biquote-quotes.js";

const PORT = Number(process.env.PORT ?? 8080);
const MAX_AGE_MS = 15_000;
const WATCHDOG_MS = 5_000;
const HEARTBEAT_LOG_MS = 60_000;
const COINBASE_STREAM = "wss://ws-feed.exchange.coinbase.com";
const BIQUOTE_HUB = "https://biquote.io/hubs/tick";
const MARKETS = ["EURUSD", "BTCUSD", "XAUUSD"];
const quotes = {};
const clients = new Set();
const counters = { coinbaseMessages: 0, biquoteMessages: 0, rejectedTicks: 0, reconnects: 0 };
const startedAt = Date.now();
let socket, coinbaseRetry, biquoteRetry, heartbeatTimer, watchdogTimer, stopping = false;
let biquoteConnection, lastHeartbeatLog = 0, lastWatchdogAt = Date.now();
let coinbaseConnectedAt = null, biquoteConnectedAt = null, lastCoinbaseMessageAt = null, lastBiquoteMessageAt = null;

function scheduleCoinbaseReconnect(reason) {
  if (stopping || coinbaseRetry) return;
  const delay = Math.min(1_000 * (2 ** Math.min(counters.reconnects++, 5)), 30_000);
  console.warn("Coinbase reconnect scheduled:", reason, "in", delay, "ms");
  coinbaseRetry = setTimeout(() => { coinbaseRetry = undefined; connectCoinbase(); }, delay);
}

function connectCoinbase() {
  if (stopping || (socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState))) return;
  socket = new WebSocket(COINBASE_STREAM, { handshakeTimeout: 10_000 });
  socket.on("open", () => {
    counters.reconnects = 0;
    coinbaseConnectedAt = Date.now();
    clearTimeout(coinbaseRetry);
    coinbaseRetry = undefined;
    socket.send(JSON.stringify({ type: "subscribe", product_ids: ["BTC-USD"], channels: ["ticker"] }));
    console.log("Coinbase BTC-USD ticker stream connected.");
  });
  socket.on("pong", () => { lastCoinbaseMessageAt = Date.now(); });
  socket.on("message", raw => {
    lastCoinbaseMessageAt = Date.now();
    counters.coinbaseMessages++;
    try {
      const quote = normalizeCoinbaseTicker(JSON.parse(raw.toString()));
      if (quote) publish("BTCUSD", quote);
    } catch (error) { counters.rejectedTicks++; console.error("Rejected malformed Coinbase message:", error.message); }
  });
  socket.on("error", error => console.error("Coinbase WebSocket error:", error.message));
  socket.on("close", () => {
    coinbaseConnectedAt = null;
    if (!stopping) scheduleCoinbaseReconnect("socket closed");
  });
}

function scheduleBiquoteReconnect(reason) {
  if (stopping || biquoteRetry) return;
  console.warn("Biquote reconnect scheduled:", reason);
  biquoteRetry = setTimeout(() => { biquoteRetry = undefined; void connectBiquote(); }, 10_000);
}

async function connectBiquote() {
  if (stopping || (biquoteConnection && [HubConnectionState.Connected, HubConnectionState.Connecting, HubConnectionState.Reconnecting].includes(biquoteConnection.state))) return;
  try {
    const connection = new HubConnectionBuilder()
      .withUrl(BIQUOTE_HUB, { WebSocket })
      .withAutomaticReconnect([0, 2_000, 5_000, 10_000, 30_000])
      .configureLogging(LogLevel.Warning)
      .build();
    biquoteConnection = connection;
    connection.on("ReceiveTick", payload => {
      lastBiquoteMessageAt = Date.now();
      counters.biquoteMessages++;
      const records = Array.isArray(payload) ? payload : [payload];
      for (const record of records) {
        const quote = normalizeBiquoteStreamTick(record);
        if (!quote) { counters.rejectedTicks++; continue; }
        const validation = validateBiquoteTick(quote, { maxAgeMs: MAX_AGE_MS });
        if (validation.valid) publish(quote.market, quote);
        else counters.rejectedTicks++;
      }
    });
    connection.onreconnecting(error => {
      biquoteConnectedAt = null;
      console.warn("Biquote stream reconnecting:", error?.message ?? "connection lost");
    });
    connection.onreconnected(async () => {
      biquoteConnectedAt = Date.now();
      console.log("Biquote stream reconnected; resubscribing.");
      try { await connection.invoke("Subscribe", ["EURUSD", "XAUUSD"]); }
      catch (error) { console.error("Biquote resubscribe failed:", error.message); }
    });
    connection.onclose(error => {
      biquoteConnectedAt = null;
      if (!stopping) scheduleBiquoteReconnect(error?.message ?? "connection closed");
    });
    await connection.start();
    biquoteConnectedAt = Date.now();
    await connection.invoke("Subscribe", ["EURUSD", "XAUUSD"]);
    console.log("Biquote EURUSD/XAUUSD stream connected.");
  } catch (error) {
    biquoteConnectedAt = null;
    console.error("Biquote stream connection failed:", error.message);
    scheduleBiquoteReconnect("start or subscribe failed");
  }
}

function publish(market, quote) {
  quotes[market] = quote;
  const event = "event: quote\ndata: " + JSON.stringify({ market, quote, updatedAt: Date.now() }) + "\n\n";
  for (const client of clients) {
    if (!client.destroyed) client.write(event);
  }
}

function marketStatus(market) {
  const quote = quotes[market];
  if (!quote) return { status: "UNAVAILABLE", ageMs: null, source: null, timestamp: null };
  const ageMs = Date.now() - quote.timestamp;
  const fresh = ageMs >= 0 && ageMs <= MAX_AGE_MS;
  return { status: fresh ? "FRESH" : "STALE", ageMs, source: quote.source, timestamp: quote.timestamp, bid: quote.bid, ask: quote.ask };
}

function brainSnapshot() {
  const markets = Object.fromEntries(MARKETS.map(market => [market, marketStatus(market)]));
  const freshMarkets = Object.values(markets).filter(item => item.status === "FRESH").length;
  return {
    service: "forex-sniper-24x7-brain",
    process: "RUNNING",
    status: freshMarkets === MARKETS.length ? "ONLINE" : "DEGRADED",
    statusCheckedAt: Date.now(),
    uptimeSeconds: Math.floor(process.uptime()),
    startedAt,
    heartbeatAt: Date.now(),
    watchdog: { intervalMs: WATCHDOG_MS, lastCheckAt: lastWatchdogAt },
    providers: {
      coinbase: { connected: Boolean(socket && socket.readyState === WebSocket.OPEN), connectedAt: coinbaseConnectedAt, lastMessageAt: lastCoinbaseMessageAt },
      biquote: { connected: biquoteConnection?.state === HubConnectionState.Connected, state: biquoteConnection?.state ?? "DISCONNECTED", connectedAt: biquoteConnectedAt, lastMessageAt: lastBiquoteMessageAt }
    },
    markets,
    coverage: { freshMarkets, totalMarkets: MARKETS.length },
    counters
  };
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("content-type", "application/json");
  if (url.pathname === "/" || url.pathname === "/health" || url.pathname === "/brain" || url.pathname === "/status") {
    const snapshot = brainSnapshot();
    response.writeHead(200);
    response.end(JSON.stringify({ ...snapshot, dataStatus: snapshot.coverage.freshMarkets === MARKETS.length ? "ALL_MARKETS_FRESH" : "PARTIAL_OR_STALE" }));
    return;
  }
  if (url.pathname === "/ready") {
    const snapshot = brainSnapshot();
    const ready = snapshot.coverage.freshMarkets === MARKETS.length;
    response.writeHead(ready ? 200 : 503);
    response.end(JSON.stringify({ ready, coverage: snapshot.coverage, markets: snapshot.markets }));
    return;
  }
  if (url.pathname === "/quotes") {
    response.writeHead(200);
    response.end(JSON.stringify({ quotes, updatedAt: Date.now(), maxAgeMs: MAX_AGE_MS, markets: brainSnapshot().markets }));
    return;
  }
  if (url.pathname === "/stream") {
    response.writeHead(200, { "content-type": "text/event-stream", "connection": "keep-alive" });
    response.write("retry: 3000\n\n");
    clients.add(response);
    response.write("event: heartbeat\ndata: " + JSON.stringify(brainSnapshot()) + "\n\n");
    for (const [market, quote] of Object.entries(quotes)) response.write("event: quote\ndata: " + JSON.stringify({ market, quote, updatedAt: Date.now() }) + "\n\n");
    request.on("close", () => clients.delete(response));
    return;
  }
  response.writeHead(404);
  response.end(JSON.stringify({ error: "not_found" }));
});

server.listen(PORT, "0.0.0.0", () => console.log("Forex Sniper 24/7 brain listening on", PORT));
connectCoinbase();
void connectBiquote();

watchdogTimer = setInterval(() => {
  lastWatchdogAt = Date.now();
  if (!socket || socket.readyState === WebSocket.CLOSED) connectCoinbase();
  if (!biquoteConnection || biquoteConnection.state === HubConnectionState.Disconnected) void connectBiquote();
  if (Date.now() - lastHeartbeatLog >= HEARTBEAT_LOG_MS) {
    lastHeartbeatLog = Date.now();
    const snapshot = brainSnapshot();
    console.log("BRAIN_STATUS", JSON.stringify({ status: snapshot.status, checkedAt: new Date(snapshot.statusCheckedAt).toISOString(), uptimeSeconds: snapshot.uptimeSeconds, coverage: snapshot.coverage, providers: snapshot.providers, markets: snapshot.markets, counters: snapshot.counters }));
  }
}, WATCHDOG_MS);

heartbeatTimer = setInterval(() => {
  const event = "event: heartbeat\ndata: " + JSON.stringify(brainSnapshot()) + "\n\n";
  for (const client of clients) if (!client.destroyed) client.write(event);
}, 15_000);

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.warn("Graceful shutdown:", signal);
  clearInterval(watchdogTimer);
  clearInterval(heartbeatTimer);
  clearTimeout(coinbaseRetry);
  clearTimeout(biquoteRetry);
  socket?.close(1000, "service shutdown");
  void biquoteConnection?.stop();
  for (const client of clients) client.end();
  server.close(() => process.exit(0));
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", error => {
  console.error("Fatal unhandled rejection:", error);
  process.exit(1);
});
process.on("uncaughtException", error => {
  console.error("Fatal uncaught exception:", error);
  process.exit(1);
});
