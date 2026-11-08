import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

const SYMBOL = "btcusdt";
const STREAM_URL = "wss://data-stream.binance.vision/stream?streams=btcusdt@aggTrade/btcusdt@bookTicker/btcusdt@kline_5m/btcusdt@kline_15m/btcusdt@kline_1h";
const DATA = "data";
const FILES = {
  "5m": "online-btcusdt-m5.json",
  "15m": "online-btcusdt-m15.json",
  "1h": "online-btcusdt-h1.json"
};
const KEEP = { "5m": 20000, "15m": 10000, "1h": 5000 };
const INTERVAL_MS = { "5m": 300000, "15m": 900000, "1h": 3600000 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let candles = {};
let market = {};
let socket;
let shuttingDown = false;
let lastMessageAt = 0;
let lastMarketWrite = 0;
let reconnectAttempt = 0;
let lastPushAt = 0;
let analysisRunning = false;
let analysisQueued = false;

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { return fallback; }
}

async function atomicJson(path, value) {
  const temp = path + ".tmp";
  await writeFile(temp, JSON.stringify(value) + "\n");
  await rename(temp, path);
}

async function run(command, args, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(command + " exited " + code)));
  });
}

async function bootstrap() {
  await mkdir(DATA, { recursive: true });
  console.log("Bootstrapping closed candle history from Binance REST...");
  await run("node", ["src/online-market-data.js"]);
  for (const [tf, file] of Object.entries(FILES)) {
    candles[tf] = await readJson(DATA + "/" + file, []);
  }
  market = await readJson(DATA + "/online-market.json", {});
  console.log("Loaded candle history:", Object.fromEntries(Object.entries(candles).map(([tf, rows]) => [tf, rows.length])));
}

function normalizeKline(k) {
  return {
    timestamp: Number(k.t),
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume: Number(k.v),
    closeTime: Number(k.T),
    quoteVolume: Number(k.q),
    trades: Number(k.n),
    takerBuyBaseVolume: Number(k.V),
    takerBuyQuoteVolume: Number(k.Q),
    source: "Binance Spot BTCUSDT WebSocket"
  };
}

async function saveCandle(tf, kline) {
  const candle = normalizeKline(kline);
  const rows = candles[tf] ?? [];
  const index = rows.findIndex(row => Number(row.timestamp) === candle.timestamp);
  if (index >= 0) rows[index] = candle;
  else rows.push(candle);
  rows.sort((a, b) => a.timestamp - b.timestamp);
  candles[tf] = rows.slice(-KEEP[tf]);
  await atomicJson(DATA + "/" + FILES[tf], candles[tf]);
  market.candleLastTimes ??= {};
  market.candleLastTimes[tf] = new Date(candle.timestamp).toISOString();
  market.generatedAt = new Date().toISOString();
  console.log(tf, "closed:", new Date(candle.timestamp).toISOString(), "close:", candle.close);
  await writeMarket();
  if (tf === "5m") {
    await runAnalysis();
    await publishRepository();
  } else {
    queueAnalysis();
  }
}

async function writeMarket() {
  const now = Date.now();
  if (now - lastMarketWrite < 1000) return;
  lastMarketWrite = now;
  market.schemaVersion = 2;
  market.symbol = "BTCUSDT";
  market.instrumentType = "spot";
  market.source = "Binance Spot public WebSocket";
  market.sourceUrl = "wss://data-stream.binance.vision";
  market.referenceOnly = "BTCUSDT spot is a market proxy, not Vantage BTCUSD CFD pricing";
  market.generatedAt = new Date().toISOString();
  await atomicJson(DATA + "/online-market.json", market);
}

async function runAnalysis() {
  if (analysisRunning) { analysisQueued = true; return; }
  analysisRunning = true;
  try {
    do {
      analysisQueued = false;
      console.log("Running combined BTC signal engine on latest closed candles...");
      await run("node", ["src/index.js"], { ...process.env, MARKET_DATA_SOURCE: "binance" });
    } while (analysisQueued);
  } catch (error) {
    console.error("Signal analysis failed:", error.message);
  } finally {
    analysisRunning = false;
  }
}

function queueAnalysis() {
  if (analysisRunning) analysisQueued = true;
  else void runAnalysis();
}

async function refresh24h() {
  try {
    const response = await fetch("https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT", { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("Binance 24h ticker HTTP " + response.status);
    const t = await response.json();
    Object.assign(market, {
      change24h: Number(t.priceChange),
      changePercent24h: Number(t.priceChangePercent),
      high24h: Number(t.highPrice),
      low24h: Number(t.lowPrice),
      baseVolume24h: Number(t.volume),
      quoteVolume24h: Number(t.quoteVolume),
      trades24h: Number(t.count),
      tickerUpdatedAt: new Date().toISOString()
    });
    await writeMarket();
  } catch (error) {
    console.warn("24h ticker refresh failed:", error.message);
  }
}

async function publishRepository() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn("GITHUB_TOKEN missing: data is saved on persistent disk but not pushed to GitHub.");
    return;
  }
  if (Date.now() - lastPushAt < 4 * 60 * 1000) return;
  const owner = "Nake111";
  const repo = "forex-sniper";
  const branch = process.env.GITHUB_BRANCH || "Btcusd";
  const api = "https://api.github.com";
  const headers = {
    "Accept": "application/vnd.github+json",
    "Authorization": "Bearer " + token,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json"
  };
  const request = async (path, options = {}) => {
    const response = await fetch(api + path, { ...options, headers: { ...headers, ...(options.headers || {}) }, signal: AbortSignal.timeout(20000) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("GitHub API " + response.status + ": " + JSON.stringify(body).slice(0, 500));
    return body;
  };

  try {
    const ref = await request(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
    const parentSha = ref.object.sha;
    const parent = await request(`/repos/${owner}/${repo}/git/commits/${parentSha}`);
    const files = [
      ["data/online-btcusdt-m5.json", candles["5m"]],
      ["data/online-btcusdt-m15.json", candles["15m"]],
      ["data/online-btcusdt-h1.json", candles["1h"]],
      ["data/online-market.json", market],
      ["data/latest-signal.json", await readJson(DATA + "/latest-signal.json", {})]
    ];
    const tree = [];
    for (const [path, value] of files) {
      const content = JSON.stringify(value, null, 2) + "\n";
      const blob = await request(`/repos/${owner}/${repo}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: Buffer.from(content).toString("base64"), encoding: "base64" })
      });
      tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const newTree = await request(`/repos/${owner}/${repo}/git/trees`, {
      method: "POST", body: JSON.stringify({ base_tree: parent.tree.sha, tree })
    });
    const commit = await request(`/repos/${owner}/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({ message: "Persist live BTC WebSocket market data", tree: newTree.sha, parents: [parentSha] })
    });
    await request(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false })
    });
    lastPushAt = Date.now();
    console.log("Live WebSocket snapshot committed to GitHub:", commit.sha);
  } catch (error) {
    console.error("GitHub market-data publish failed:", error.message);
  }
}

function connect() {
  if (shuttingDown) return;
  console.log("Connecting Binance market-data WebSocket...");
  socket = new WebSocket(STREAM_URL, {
    handshakeTimeout: 15000,
    perMessageDeflate: false
  });
  let rotateTimer;
  let heartbeatTimer;

  socket.on("open", () => {
    reconnectAttempt = 0;
    lastMessageAt = Date.now();
    console.log("Binance WebSocket connected:", STREAM_URL);
    rotateTimer = setTimeout(() => {
      console.log("Rotating WebSocket before Binance 24-hour connection limit.");
      socket?.close(1000, "planned 23h50m reconnect");
    }, 23 * 60 * 60 * 1000 + 50 * 60 * 1000);
    heartbeatTimer = setInterval(() => {
      if (Date.now() - lastMessageAt > 90000) {
        console.warn("WebSocket data timeout; terminating for reconnect.");
        socket?.terminate();
      } else if (socket?.readyState === WebSocket.OPEN) {
        socket.ping();
      }
    }, 30000);
  });

  socket.on("message", async raw => {
    lastMessageAt = Date.now();
    try {
      const envelope = JSON.parse(raw.toString());
      const event = envelope.data ?? envelope;
      if (event.e === "serverShutdown") {
        console.warn("Binance serverShutdown event; reconnecting.");
        socket.close(1012, "server shutdown");
        return;
      }
      if (event.e === "aggTrade") {
        market.lastPrice = Number(event.p);
        market.lastTradeAt = new Date(Number(event.T)).toISOString();
        market.lastTradeQty = Number(event.q);
        market.lastTradeSide = event.m ? "SELL_TAKER" : "BUY_TAKER";
        await writeMarket();
      } else if (event.e === "bookTicker") {
        market.bid = Number(event.b);
        market.ask = Number(event.a);
        market.bidQty = Number(event.B);
        market.askQty = Number(event.A);
        market.spread = market.ask - market.bid;
        market.bookUpdatedAt = new Date().toISOString();
        await writeMarket();
      } else if (event.e === "kline" && event.k?.x === true) {
        const tf = event.k.i;
        if (FILES[tf]) await saveCandle(tf, event.k);
      }
    } catch (error) {
      console.error("WebSocket message handling error:", error.message);
    }
  });

  socket.on("error", error => console.error("WebSocket error:", error.message));
  socket.on("close", async (code, reason) => {
    clearTimeout(rotateTimer);
    clearInterval(heartbeatTimer);
    console.warn("WebSocket closed:", code, reason.toString());
    if (shuttingDown) return;
    reconnectAttempt++;
    const wait = Math.min(60000, 1000 * (2 ** Math.min(reconnectAttempt, 6)));
    console.log("Reconnecting in", wait, "ms");
    await sleep(wait);
    connect();
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("Shutdown requested:", signal);
  try {
    await writeMarket();
    await publishRepository();
  } finally {
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "service shutdown");
    setTimeout(() => process.exit(0), 1500).unref();
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

async function main() {
  await bootstrap();
  await refresh24h();
  setInterval(() => void refresh24h(), 60000).unref();
  connect();
  console.log("Persistent BTC WebSocket collector running. Market: 24/7.");
}

main().catch(error => {
  console.error("Fatal WebSocket collector error:", error);
  process.exit(1);
});
