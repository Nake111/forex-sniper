import http from "node:http";
import WebSocket from "ws";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const COINBASE_URL = "wss://advanced-trade-ws.coinbase.com";
const KRAKEN_URL = "wss://futures.kraken.com/ws/v1";
const COINBASE_PRODUCT = "BTC-USD";
const KRAKEN_PRODUCT = "PF_XBTUSD";
const WINDOW_MS = 60_000;
const MAX_AGE_MS = 30_000;
const REFRESH_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export function normalizeCoinbaseTrade(trade) {
  const timestamp = Date.parse(trade?.time);
  const quantity = Number(trade?.size);
  const side = String(trade?.side ?? "").toUpperCase();
  if (trade?.product_id !== COINBASE_PRODUCT || !Number.isFinite(timestamp) ||
      !Number.isFinite(quantity) || quantity <= 0 || !["BUY", "SELL"].includes(side)) return null;
  return { id: String(trade.trade_id ?? ""), timestamp, quantity, side };
}

export function normalizeKrakenTrade(trade) {
  const timestamp = Number(trade?.time);
  const quantity = Number(trade?.qty);
  const side = String(trade?.side ?? "").toLowerCase();
  if (trade?.product_id !== KRAKEN_PRODUCT || !Number.isFinite(timestamp) ||
      !Number.isFinite(quantity) || quantity <= 0 || !["buy", "sell"].includes(side) ||
      (trade.type && trade.type !== "fill")) return null;
  return { id: String(trade.uid ?? ""), timestamp, quantity, side: side.toUpperCase() };
}

export function summarizeAggressorTrades(trades, now = Date.now()) {
  const recent = trades.filter(trade => trade.timestamp >= now - WINDOW_MS && trade.timestamp <= now + 2_000);
  if (!recent.length) throw new Error("No trades in the latest 60-second order-flow window");
  let buyVolume = 0;
  let sellVolume = 0;
  let timestamp = 0;
  for (const trade of recent) {
    if (trade.side === "BUY") buyVolume += trade.quantity;
    else if (trade.side === "SELL") sellVolume += trade.quantity;
    else throw new Error("Trade aggressor side is missing or invalid");
    timestamp = Math.max(timestamp, trade.timestamp);
  }
  return { buyVolume, sellVolume, cvd: buyVolume - sellVolume, timestamp, tradeCount: recent.length };
}

export function calculateOpenInterestChange(current, baseline) {
  if (!Number.isFinite(current) || current <= 0 || !baseline ||
      !Number.isFinite(baseline.value) || baseline.value <= 0 ||
      !Number.isFinite(baseline.timestamp)) return null;
  if (baseline.timestamp + WINDOW_MS > Date.now()) return null;
  return ((current - baseline.value) / baseline.value) * 100;
}

export function createOrderFlowServer({
  port = Number(process.env.PORT) || 3000,
  now = Date.now,
  WebSocketImpl = WebSocket
} = {}) {
  const spotTrades = [];
  const perpetualTrades = [];
  const seenSpot = new Set();
  const seenPerpetual = new Set();
  let ticker = null;
  let oiBaseline = null;
  let latestSnapshot = null;
  let lastError = "Waiting for Coinbase and Kraken market-data snapshots";
  let coinbaseSocket = null;
  let krakenSocket = null;
  let stopping = false;
  let refreshTimer = null;
  let coinbaseReconnect = null;
  let krakenReconnect = null;
  let coinbaseAttempt = 0;
  let krakenAttempt = 0;

  function addTrade(list, seen, trade, maxRows = 20_000) {
    if (!trade) return;
    if (trade.id && seen.has(trade.id)) return;
    if (trade.id) {
      seen.add(trade.id);
      if (seen.size > maxRows * 2) {
        const oldest = list.splice(0, Math.max(1, list.length - maxRows));
        for (const item of oldest) if (item.id) seen.delete(item.id);
      }
    }
    list.push(trade);
    while (list.length > maxRows) {
      const removed = list.shift();
      if (removed?.id) seen.delete(removed.id);
    }
  }

  function acceptCoinbase(raw) {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.channel !== "market_trades" || !Array.isArray(message.events)) return;
    for (const event of message.events) {
      for (const rawTrade of event.trades ?? []) {
        addTrade(spotTrades, seenSpot, normalizeCoinbaseTrade(rawTrade));
      }
    }
  }

  function acceptKraken(raw) {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    const receivedAt = now();
    if (message.feed === "trade" && message.product_id === KRAKEN_PRODUCT) {
      addTrade(perpetualTrades, seenPerpetual, normalizeKrakenTrade(message));
    } else if (message.feed === "trade_snapshot" && message.product_id === KRAKEN_PRODUCT &&
               Array.isArray(message.trades)) {
      for (const rawTrade of message.trades) {
        addTrade(perpetualTrades, seenPerpetual, normalizeKrakenTrade(rawTrade));
      }
    } else if (message.feed === "ticker" && message.product_id === KRAKEN_PRODUCT) {
      const openInterest = Number(message.openInterest);
      const fundingRate = Number(message.fundingRate);
      if (Number.isFinite(openInterest) && openInterest > 0 && Number.isFinite(fundingRate)) {
        const providerTime = typeof message.time === "number" ? message.time
          : Date.parse(message.time ?? message.serverTime ?? "");
        ticker = {
          openInterest,
          fundingRate,
          timestamp: Number.isFinite(providerTime) ? providerTime : receivedAt,
          receivedAt
        };
        if (!oiBaseline) oiBaseline = { value: openInterest, timestamp: receivedAt };
        else if (receivedAt - oiBaseline.timestamp >= WINDOW_MS) {
          ticker.openInterestChangePct = ((openInterest - oiBaseline.value) / oiBaseline.value) * 100;
          oiBaseline = { value: openInterest, timestamp: receivedAt };
        }
      }
    }
  }

  function connect(url, subscriptions, onMessage, kind) {
    if (stopping) return;
    const socket = new WebSocketImpl(url, { handshakeTimeout: 15_000 });
    const setSocket = kind === "coinbase" ? value => { coinbaseSocket = value; } : value => { krakenSocket = value; };
    const getAttempt = () => kind === "coinbase" ? coinbaseAttempt : krakenAttempt;
    const setAttempt = value => { if (kind === "coinbase") coinbaseAttempt = value; else krakenAttempt = value; };
    const setReconnect = value => { if (kind === "coinbase") coinbaseReconnect = value; else krakenReconnect = value; };
    setSocket(socket);
    let heartbeatTimer = null;
    socket.on("open", () => {
      heartbeatTimer = setInterval(() => {
        if (socket.readyState === WebSocketImpl.OPEN) socket.ping();
      }, 20_000);
      heartbeatTimer.unref?.();
      for (const subscription of (Array.isArray(subscriptions) ? subscriptions : [subscriptions])) {
        socket.send(JSON.stringify(subscription));
      }
      setAttempt(0);
      setReconnect(null);
      console.log(kind.toUpperCase() + " public market-data stream connected");
    });
    socket.on("message", onMessage);
    socket.on("error", error => {
      lastError = kind + " websocket: " + error.message;
      console.error(lastError);
    });
    socket.on("close", () => {
      clearInterval(heartbeatTimer);
      if (stopping) return;
      const delay = Math.min(1_000 * (2 ** getAttempt()), RECONNECT_MAX_MS);
      setAttempt(getAttempt() + 1);
      const timer = setTimeout(() => connect(url, subscriptions, onMessage, kind), delay);
      setReconnect(timer);
    });
  }

  function buildSnapshot() {
    const currentTime = now();
    const spot = summarizeAggressorTrades(spotTrades, currentTime);
    const perpetual = summarizeAggressorTrades(perpetualTrades, currentTime);
    if (!ticker || !Number.isFinite(ticker.openInterestChangePct)) {
      throw new Error("Kraken perpetual open-interest baseline is warming up; wait for 60 seconds of live observations");
    }
    const tickerAge = currentTime - ticker.timestamp;
    const ageMs = currentTime - Math.min(spot.timestamp, perpetual.timestamp, ticker.timestamp);
    if (tickerAge < -2_000 || tickerAge > MAX_AGE_MS || ageMs < -2_000 || ageMs > MAX_AGE_MS) {
      throw new Error("Coinbase or Kraken order-flow evidence is stale or has a future timestamp");
    }
    return {
      symbol: "BTC-USD",
      source: "Coinbase Advanced Trade BTC-USD spot + Kraken Futures PF_XBTUSD perpetual",
      timestamp: Math.min(spot.timestamp, perpetual.timestamp, ticker.timestamp),
      spot: { buyVolume: spot.buyVolume, sellVolume: spot.sellVolume, cvd: spot.cvd },
      perpetual: {
        buyVolume: perpetual.buyVolume,
        sellVolume: perpetual.sellVolume,
        cvd: perpetual.cvd,
        openInterestChangePct: ticker.openInterestChangePct,
        fundingRate: ticker.fundingRate
      }
    };
  }

  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    if (request.url === "/health") {
      const ready = Boolean(latestSnapshot && now() - latestSnapshot.timestamp <= MAX_AGE_MS);
      response.writeHead(200);
      response.end(JSON.stringify({
        status: ready ? "READY" : "WARMING_UP",
        providers: { coinbase: coinbaseSocket?.readyState === WebSocketImpl.OPEN ? "CONNECTED" : "DISCONNECTED",
          kraken: krakenSocket?.readyState === WebSocketImpl.OPEN ? "CONNECTED" : "DISCONNECTED" },
        lastError,
        snapshotTimestamp: latestSnapshot?.timestamp ?? null,
        spotTradeCount: spotTrades.length,
        perpetualTradeCount: perpetualTrades.length,
        lastSpotTradeAt: spotTrades.at(-1)?.timestamp ?? null,
        lastPerpetualTradeAt: perpetualTrades.at(-1)?.timestamp ?? null,
        krakenTicker: ticker ? {
          openInterest: ticker.openInterest,
          fundingRate: ticker.fundingRate,
          openInterestChangePct: ticker.openInterestChangePct ?? null,
          providerTimestamp: ticker.timestamp,
          receivedAt: ticker.receivedAt
        } : null,
        openInterestBaseline: oiBaseline
      }));
      return;
    }
    if (request.url === "/order-flow") {
      const ageMs = latestSnapshot ? now() - latestSnapshot.timestamp : Infinity;
      if (!latestSnapshot || ageMs < -2_000 || ageMs > MAX_AGE_MS) {
        response.writeHead(503);
        response.end(JSON.stringify({ status: "UNAVAILABLE", reason: lastError || "Snapshot is stale" }));
        return;
      }
      response.writeHead(200);
      response.end(JSON.stringify(latestSnapshot));
      return;
    }
    response.writeHead(404);
    response.end(JSON.stringify({ error: "Use /health or /order-flow" }));
  });

  function refresh() {
    try {
      latestSnapshot = buildSnapshot();
      lastError = null;
    } catch (error) {
      lastError = error.message;
    }
  }

  return {
    server,
    async start() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "0.0.0.0", resolve);
      });
      connect(COINBASE_URL, { type: "subscribe", product_ids: [COINBASE_PRODUCT], channel: "market_trades" }, acceptCoinbase, "coinbase");
      connect(KRAKEN_URL, [
        { event: "subscribe", feed: "trade", product_ids: [KRAKEN_PRODUCT] },
        { event: "subscribe", feed: "ticker", product_ids: [KRAKEN_PRODUCT] }
      ], acceptKraken, "kraken");
      refreshTimer = setInterval(refresh, REFRESH_MS);
      refreshTimer.unref?.();
      return server.address();
    },
    async stop() {
      stopping = true;
      clearInterval(refreshTimer);
      clearTimeout(coinbaseReconnect);
      clearTimeout(krakenReconnect);
      for (const socket of [coinbaseSocket, krakenSocket]) {
        if (socket && socket.readyState < WebSocketImpl.CLOSING) socket.close(1000, "Service shutdown");
      }
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
    refresh,
    acceptCoinbase,
    acceptKraken,
    buildSnapshot
  };
}

export function isDirectExecution(moduleUrl, argvPath) {
  return Boolean(argvPath) && fileURLToPath(moduleUrl) === resolve(argvPath);
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const app = createOrderFlowServer();
  app.start().then(address => {
    process.stdout.write("Coinbase + Kraken BTC order-flow adapter listening on " + JSON.stringify(address) + "\n");
  }).catch(error => {
    process.stderr.write("Unable to start Coinbase + Kraken adapter: " + error.message + "\n");
    process.exitCode = 1;
  });
}
