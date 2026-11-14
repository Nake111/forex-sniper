import http from "node:http";
import { open, readFile, stat } from "node:fs/promises";
import WebSocket from "ws";
import { HubConnectionBuilder, HubConnectionState, LogLevel } from "@microsoft/signalr";
import { normalizeCoinbaseTicker, normalizeBiquoteStreamTick } from "./realtime-feed-core.js";
import { validateBiquoteTick } from "./biquote-quotes.js";
import { recordHistoricalQuote, flushHistoricalQuotes } from "./historical-quote-journal.js";

const PORT = Number(process.env.PORT ?? 8080);
const MAX_AGE_MS = 15_000;
const WATCHDOG_MS = 5_000;
const HEARTBEAT_LOG_MS = 60_000;
const COINBASE_STREAM = "wss://ws-feed.exchange.coinbase.com";
const BIQUOTE_HUB = "https://biquote.io/hubs/tick";
const BIQUOTE_LATEST = "https://biquote.io/api/latest";
const BIQUOTE_POLL_MS = 2_500;
const MARKETS = ["EURUSD", "BTCUSD", "XAUUSD"];
const quotes = {};
const clients = new Set();
const counters = { coinbaseMessages: 0, biquoteMessages: 0, biquoteRestPolls: 0, biquoteRestTicks: 0, biquoteRestErrors: 0, rejectedTicks: 0, reconnects: 0 };
const startedAt = Date.now();
let socket, coinbaseRetry, biquoteRetry, heartbeatTimer, watchdogTimer, biquotePollTimer, stopping = false;
let biquoteConnection, lastHeartbeatLog = 0, lastWatchdogAt = Date.now();
let coinbaseConnectedAt = null, biquoteConnectedAt = null, lastCoinbaseMessageAt = null, lastBiquoteMessageAt = null;
let biquoteRestConnected = false, lastBiquoteRestAt = null, biquotePollInFlight = false;

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
      ingestBiquotePayload(payload, "SignalR");
    });
    connection.on("ReceiveSubscriptionState", state => {
      console.log("Biquote subscription state:", JSON.stringify(state));
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

function ingestBiquotePayload(payload, source) {
  const records = Array.isArray(payload) ? payload : [payload];
  let accepted = 0;
  for (const record of records) {
    const quote = normalizeBiquoteStreamTick(record);
    if (!quote) { counters.rejectedTicks++; continue; }
    const validation = validateBiquoteTick(quote, { maxAgeMs: MAX_AGE_MS });
    if (validation.valid) {
      publish(quote.market, { ...quote, source: source === "REST"
        ? "Biquote /api/latest live bid-ask"
        : "Biquote SignalR live tick stream" });
      accepted++;
    } else counters.rejectedTicks++;
  }
  return accepted;
}

// SignalR is the preferred tick transport. The documented batch REST endpoint
// is a resilient fallback so a connected-but-silent hub cannot masquerade as
// a working market-data feed.
async function pollBiquoteRest() {
  if (stopping || biquotePollInFlight) return;
  biquotePollInFlight = true;
  counters.biquoteRestPolls++;
  try {
    const url = new URL(BIQUOTE_LATEST);
    url.searchParams.append("symbols", "EURUSD");
    url.searchParams.append("symbols", "XAUUSD");
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000), headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const payload = await response.json();
    const records = Array.isArray(payload) ? payload
      : Array.isArray(payload?.ticks) ? payload.ticks
      : Array.isArray(payload?.items) ? payload.items
      : Object.entries(payload ?? {}).map(([symbol, tick]) => ({
          ...(tick && typeof tick === "object" ? tick : {}),
          symbol: tick?.symbol ?? symbol
        }));
    let accepted = 0;
    for (const record of records) accepted += ingestBiquotePayload(record, "REST");
    biquoteRestConnected = true;
    lastBiquoteRestAt = Date.now();
    counters.biquoteRestTicks += accepted;
  } catch (error) {
    biquoteRestConnected = false;
    counters.biquoteRestErrors++;
    console.warn("Biquote REST fallback poll failed:", error.message);
  } finally {
    biquotePollInFlight = false;
  }
}

function publish(market, quote) {
  quotes[market] = quote;
  recordHistoricalQuote(market, quote, Date.now());
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
      biquote: { connected: biquoteConnection?.state === HubConnectionState.Connected, state: biquoteConnection?.state ?? "DISCONNECTED", connectedAt: biquoteConnectedAt, lastMessageAt: lastBiquoteMessageAt, restFallbackConnected: biquoteRestConnected, lastRestPollAt: lastBiquoteRestAt }
    },
    markets,
    coverage: { freshMarkets, totalMarkets: MARKETS.length },
    counters
  };
}

const server = http.createServer(async (request, response) => {
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
  if (url.pathname === "/journal-health") {
    const journalPath = process.env.PAPER_JOURNAL_PATH ?? "data/second-brain.jsonl";
    try {
      const [info, raw] = await Promise.all([stat(journalPath), readFile(journalPath, "utf8")]);
      const events = raw.split("\n").filter(Boolean).map((line, index) => {
        try { return JSON.parse(line); }
        catch { throw new Error(`Invalid JSON in paper journal at line ${index + 1}`); }
      });
      const eventCounts = {};
      const markets = {};
      for (const event of events) {
        eventCounts[event.eventType ?? event.kind ?? "UNKNOWN"] = (eventCounts[event.eventType ?? event.kind ?? "UNKNOWN"] ?? 0) + 1;
        const market = event.market;
        if (!market) continue;
        const summary = markets[market] ??= { observations: 0, signals: 0, wins: 0, losses: 0, ambiguous: 0, pending: 0, lastObservation: null };
        if (event.eventType === "PAPER_OBSERVATION") {
          summary.observations += 1;
          if (!summary.lastObservation || Number(event.observedAt) > Number(summary.lastObservation.observedAt)) {
            const quote = event.quoteEvidence ?? {};
            summary.lastObservation = {
              observedAt: event.observedAt ?? null,
              decision: event.decision ?? null,
              quote: {
                provider: quote.provider ?? null, venue: quote.venue ?? null,
                bid: quote.bid ?? null, ask: quote.ask ?? null,
                observedSpread: quote.observedSpread ?? null,
                quoteAgeMs: quote.quoteAgeMs ?? null,
                validation: quote.validation ?? "UNKNOWN",
                estimatedSpreadAndSlippageBps: quote.costs?.estimatedSpreadAndSlippageBps ?? null,
                estimatedRoundTripCostBps: quote.costs?.estimatedRoundTripCostBps ?? null,
                estimatedCommissionBpsRoundTrip: quote.costs?.estimatedCommissionBpsRoundTrip ?? null,
                commissionIncludedInRoundTripEstimate: quote.costs?.commissionIncludedInRoundTripEstimate ?? false,
                estimatedSlippageBpsPerSide: quote.costs?.estimatedSlippageBpsPerSide ?? null,
                observedSlippage: quote.costs?.observedSlippage ?? null
              }
            };
          }
        } else if (event.eventType === "PAPER_SIGNAL" || event.kind === "SIGNAL") {
          summary.signals += 1;
          if (!event.eventType || !event.eventId) summary.pending += 1;
        } else if (event.eventType === "PAPER_OUTCOME") {
          if (event.outcome === "WIN") summary.wins += 1;
          else if (event.outcome === "LOSS") summary.losses += 1;
          else if (event.outcome === "AMBIGUOUS") summary.ambiguous += 1;
        }
      }
      for (const [market, summary] of Object.entries(markets)) {
        const outcomes = summary.wins + summary.losses + summary.ambiguous;
        summary.pending = Math.max(summary.pending, summary.signals - outcomes);
      }
      const lastEvent = events.at(-1) ?? null;
      response.writeHead(200);
      response.end(JSON.stringify({
        status: events.length ? "PERSISTENT_JOURNAL_READABLE" : "JOURNAL_EMPTY",
        journalPath, bytes: info.size, eventCount: events.length, eventCounts, markets,
        lastEventType: lastEvent?.eventType ?? lastEvent?.kind ?? null,
        lastEventAt: lastEvent?.observedAt ?? lastEvent?.createdAt ?? lastEvent?.resolvedAt ?? null
      }));
    } catch (error) {
      response.writeHead(error.code === "ENOENT" ? 503 : 500);
      response.end(JSON.stringify({ status: "JOURNAL_UNAVAILABLE_OR_INVALID", journalPath, error: error.message }));
    }
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
void pollBiquoteRest();
biquotePollTimer = setInterval(() => void pollBiquoteRest(), BIQUOTE_POLL_MS);

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
  clearInterval(biquotePollTimer);
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
