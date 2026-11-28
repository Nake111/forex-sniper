import http from "node:http";

const SPOT_BASE = "https://api.binance.com";
const FUTURES_BASE = "https://fapi.binance.com";
const WINDOW_MS = 60_000;
const REFRESH_MS = 5_000;
const MAX_SNAPSHOT_AGE_MS = 30_000;

const finite = value => Number.isFinite(Number(value));

async function getJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(4_000)
  });
  if (!response.ok) throw new Error(`Binance returned HTTP ${response.status}`);
  return response.json();
}

function summarizeAggTrades(trades) {
  if (!Array.isArray(trades) || trades.length === 0) {
    throw new Error("Binance returned no trades for the 60-second order-flow window");
  }

  let buyVolume = 0;
  let sellVolume = 0;
  let timestamp = 0;
  for (const trade of trades) {
    const quantity = Number(trade.q);
    const tradeTime = Number(trade.T);
    if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(tradeTime)) {
      throw new Error("Binance trade payload contains invalid quantity or timestamp");
    }
    // Binance m=true means the buyer was maker, so the seller was the aggressor.
    if (trade.m === true) sellVolume += quantity;
    else if (trade.m === false) buyVolume += quantity;
    else throw new Error("Binance trade payload is missing the buyer-maker flag");
    timestamp = Math.max(timestamp, tradeTime);
  }

  return { buyVolume, sellVolume, cvd: buyVolume - sellVolume, timestamp };
}

export async function buildBinanceBtcOrderFlow({
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  baselineOpenInterest = null
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable");
  const startTime = now - WINDOW_MS;
  const query = `symbol=BTCUSDT&startTime=${startTime}&endTime=${now}&limit=1000`;
  const [spotTrades, perpetualTrades, openInterest, premiumIndex] = await Promise.all([
    getJson(fetchImpl, `${SPOT_BASE}/api/v3/aggTrades?${query}`),
    getJson(fetchImpl, `${FUTURES_BASE}/fapi/v1/aggTrades?${query}`),
    getJson(fetchImpl, `${FUTURES_BASE}/fapi/v1/openInterest?symbol=BTCUSDT`),
    getJson(fetchImpl, `${FUTURES_BASE}/fapi/v1/premiumIndex?symbol=BTCUSDT`)
  ]);

  const spot = summarizeAggTrades(spotTrades);
  const perpetual = summarizeAggTrades(perpetualTrades);
  const currentOi = Number(openInterest.openInterest);
  const oiTimestamp = Number(openInterest.time);
  const fundingRate = Number(premiumIndex.lastFundingRate);
  if (!Number.isFinite(currentOi) || currentOi <= 0 || !Number.isFinite(oiTimestamp) ||
      !Number.isFinite(fundingRate)) {
    throw new Error("Binance open-interest or funding payload is invalid");
  }

  let baseline = baselineOpenInterest;
  let openInterestChangePct = null;
  if (!baseline || !Number.isFinite(baseline.value) || baseline.value <= 0 ||
      !Number.isFinite(baseline.timestamp) || now - baseline.timestamp >= WINDOW_MS) {
    baseline = { value: currentOi, timestamp: now };
  } else if (now - baseline.timestamp >= WINDOW_MS) {
    openInterestChangePct = ((currentOi - baseline.value) / baseline.value) * 100;
    baseline = { value: currentOi, timestamp: now };
  }

  if (openInterestChangePct === null) {
    throw Object.assign(new Error("Open-interest baseline is warming up; wait for a full 60-second observation"), {
      code: "WARMING_UP",
      baseline
    });
  }

  const timestamp = Math.min(spot.timestamp, perpetual.timestamp, oiTimestamp);
  const ageMs = now - timestamp;
  if (ageMs < -2_000 || ageMs > MAX_SNAPSHOT_AGE_MS) {
    throw new Error("Binance order-flow evidence is stale or has a future timestamp");
  }

  return {
    snapshot: {
      symbol: "BTC-USD",
      source: "Binance Spot + Binance USD-M Perpetual",
      timestamp,
      spot: {
        buyVolume: spot.buyVolume,
        sellVolume: spot.sellVolume,
        cvd: spot.cvd
      },
      perpetual: {
        buyVolume: perpetual.buyVolume,
        sellVolume: perpetual.sellVolume,
        cvd: perpetual.cvd,
        openInterestChangePct,
        fundingRate
      }
    },
    baselineOpenInterest: baseline
  };
}

export function createOrderFlowServer({
  fetchImpl = globalThis.fetch,
  port = Number(process.env.PORT) || 3000,
  now = Date.now
} = {}) {
  let latestSnapshot = null;
  let baselineOpenInterest = null;
  let lastError = "Feed is warming up";
  let refreshing = false;
  let stopped = false;

  async function refresh() {
    if (refreshing || stopped) return;
    refreshing = true;
    try {
      const result = await buildBinanceBtcOrderFlow({
        fetchImpl,
        now: now(),
        baselineOpenInterest
      });
      latestSnapshot = result.snapshot;
      baselineOpenInterest = result.baselineOpenInterest;
      lastError = null;
    } catch (error) {
      if (error.baselineOpenInterest) baselineOpenInterest = error.baselineOpenInterest;
      lastError = error.message;
    } finally {
      refreshing = false;
    }
  }

  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    if (request.url === "/health") {
      response.writeHead(200);
      response.end(JSON.stringify({ status: latestSnapshot ? "READY" : "WARMING_UP", lastError }));
      return;
    }
    if (request.url === "/order-flow") {
      const ageMs = latestSnapshot ? now() - latestSnapshot.timestamp : Infinity;
      if (!latestSnapshot || ageMs < -2_000 || ageMs > MAX_SNAPSHOT_AGE_MS) {
        response.writeHead(503);
        response.end(JSON.stringify({ status: "UNAVAILABLE", reason: lastError || "Snapshot is stale" }));
        return;
      }
      response.writeHead(200);
      response.end(JSON.stringify(latestSnapshot));
      return;
    }
    response.writeHead(404);
    response.end(JSON.stringify({ error: "Not found" }));
  });

  const loop = async () => {
    while (!stopped) {
      await refresh();
      await new Promise(resolve => setTimeout(resolve, REFRESH_MS));
    }
  };

  return {
    server,
    async start() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, resolve);
      });
      void loop();
      return server.address();
    },
    async stop() {
      stopped = true;
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
    refresh
  };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const app = createOrderFlowServer();
  app.start().then(address => {
    process.stdout.write(`Binance BTC order-flow adapter listening on ${JSON.stringify(address)}\\n`);
  }).catch(error => {
    process.stderr.write(`Unable to start Binance BTC order-flow adapter: ${error.message}\\n`);
    process.exitCode = 1;
  });
}
