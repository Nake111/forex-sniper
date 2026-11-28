import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { buildBinanceBtcOrderFlow, isDirectExecution } from "./binance-btc-order-flow.js";

const now = 1_800_000_000_000;

function assertApprox(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `Expected ${actual} to be close to ${expected}`);
}

function mockFetch() {
  const routes = [
    {
      match: "/api/v3/aggTrades",
      body: [
        { a: 1, q: "2", T: now - 2_000, m: false },
        { a: 2, q: "1", T: now - 1_000, m: true }
      ]
    },
    {
      match: "/fapi/v1/aggTrades",
      body: [
        { a: 1, q: "4", T: now - 2_000, m: false },
        { a: 2, q: "3", T: now - 1_000, m: true }
      ]
    },
    { match: "/fapi/v1/openInterest", body: { openInterest: "101", time: now - 500 } },
    { match: "/fapi/v1/premiumIndex", body: { lastFundingRate: "0.0002" } }
  ];
  return async url => {
    const route = routes.find(item => url.includes(item.match));
    assert.ok(route, `Unexpected URL: ${url}`);
    return { ok: true, json: async () => route.body };
  };
}

test("calculates aggressive spot and perpetual CVD with Binance maker-side semantics", async () => {
  const result = await buildBinanceBtcOrderFlow({
    fetchImpl: mockFetch(),
    now,
    baselineOpenInterest: { value: 100, timestamp: now - 60_000 }
  });
  assert.equal(result.snapshot.spot.buyVolume, 2);
  assert.equal(result.snapshot.spot.sellVolume, 1);
  assert.equal(result.snapshot.spot.cvd, 1);
  assert.equal(result.snapshot.perpetual.buyVolume, 4);
  assert.equal(result.snapshot.perpetual.sellVolume, 3);
  assert.equal(result.snapshot.perpetual.cvd, 1);
  assert.equal(result.snapshot.perpetual.openInterestChangePct, 1);
  assert.equal(result.snapshot.perpetual.fundingRate, 0.0002);
  assert.equal(result.snapshot.source, "Binance Spot + Binance USD-M Perpetual");
});

test("fails closed while the open-interest baseline is warming up", async () => {
  await assert.rejects(
    buildBinanceBtcOrderFlow({
      fetchImpl: mockFetch(),
      now,
      baselineOpenInterest: { value: 100, timestamp: now - 20_000 }
    }),
    error => error.code === "WARMING_UP" && error.baselineOpenInterest.value === 100
  );
});

test("rejects malformed trades rather than guessing aggressor direction", async () => {
  const fetchImpl = async url => {
    if (url.includes("/api/v3/aggTrades")) {
      return { ok: true, json: async () => [{ a: 1, q: "1", T: now - 1_000 }] };
    }
    if (url.includes("/fapi/v1/aggTrades")) {
      return { ok: true, json: async () => [{ a: 1, q: "1", T: now - 1_000, m: false }] };
    }
    if (url.includes("/fapi/v1/openInterest")) {
      return { ok: true, json: async () => ({ openInterest: "100", time: now }) };
    }
    return { ok: true, json: async () => ({ lastFundingRate: "0.0001" }) };
  };
  await assert.rejects(
    buildBinanceBtcOrderFlow({
      fetchImpl,
      now,
      baselineOpenInterest: { value: 99, timestamp: now - 60_000 }
    }),
    /buyer-maker flag/
  );
});

test("recognizes direct execution when argv uses a relative path", () => {
  const absolutePath = resolve("src/binance-btc-order-flow.js");
  assert.equal(isDirectExecution(pathToFileURL(absolutePath).href, "src/binance-btc-order-flow.js"), true);
  assert.equal(isDirectExecution(pathToFileURL(absolutePath).href, "src/other-file.js"), false);
  assert.equal(isDirectExecution(pathToFileURL(absolutePath).href, undefined), false);
});

test("paginates capped spot and perpetual aggregate-trade windows without truncating CVD", async () => {
  const makePage = (startId, count, maker = false) => Array.from({ length: count }, (_, index) => ({
    a: startId + index,
    q: "0.001",
    T: now - 2_000 + index,
    m: maker
  }));
  const firstSpot = makePage(1, 1_000, false);
  const firstPerp = makePage(10_001, 1_000, false);
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    if (url.includes("/api/v3/aggTrades") && url.includes("startTime=")) return { ok: true, json: async () => firstSpot };
    if (url.includes("/api/v3/aggTrades") && url.includes("fromId=1001")) {
      return { ok: true, json: async () => [
        { a: 1001, q: "0.002", T: now - 100, m: true },
        { a: 1002, q: "9", T: now + 100, m: false }
      ] };
    }
    if (url.includes("/fapi/v1/aggTrades") && url.includes("startTime=")) return { ok: true, json: async () => firstPerp };
    if (url.includes("/fapi/v1/aggTrades") && url.includes("fromId=11001")) {
      return { ok: true, json: async () => [
        { a: 11001, q: "0.003", T: now - 100, m: true },
        { a: 11002, q: "9", T: now + 100, m: false }
      ] };
    }
    if (url.includes("/fapi/v1/openInterest")) return { ok: true, json: async () => ({ openInterest: "101", time: now - 500 }) };
    if (url.includes("/fapi/v1/premiumIndex")) return { ok: true, json: async () => ({ lastFundingRate: "0.0002" }) };
    throw new Error("Unexpected URL: " + url);
  };
  const result = await buildBinanceBtcOrderFlow({
    fetchImpl,
    now,
    baselineOpenInterest: { value: 100, timestamp: now - 60_000 }
  });
  assertApprox(result.snapshot.spot.buyVolume, 1);
  assertApprox(result.snapshot.spot.sellVolume, 0.002);
  assertApprox(result.snapshot.spot.cvd, 0.998);
  assertApprox(result.snapshot.perpetual.buyVolume, 1);
  assertApprox(result.snapshot.perpetual.sellVolume, 0.003);
  assertApprox(result.snapshot.perpetual.cvd, 0.997);
  assert.equal(urls.filter(url => url.includes("fromId=")).length, 2);
  assert.ok(urls.filter(url => url.includes("fromId=")).every(url => !url.includes("startTime=") && !url.includes("endTime=")));
});

test("fails closed when the aggregate-trade pagination safety limit is exhausted", async () => {
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    if (url.includes("/api/v3/aggTrades")) {
      const startId = Number(new URL(url).searchParams.get("fromId") ?? 1);
      const trades = Array.from({ length: 1_000 }, (_, index) => ({
        a: startId + index, q: "0.001", T: now - 1_000 + index, m: false
      }));
      return { ok: true, json: async () => trades };
    }
    if (url.includes("/fapi/v1/aggTrades")) return { ok: true, json: async () => [{ a: 1, q: "1", T: now - 1_000, m: false }] };
    if (url.includes("/fapi/v1/openInterest")) return { ok: true, json: async () => ({ openInterest: "100", time: now }) };
    return { ok: true, json: async () => ({ lastFundingRate: "0.0001" }) };
  };
  await assert.rejects(
    buildBinanceBtcOrderFlow({
      fetchImpl,
      now,
      baselineOpenInterest: { value: 99, timestamp: now - 60_000 }
    }),
    /exceeded the 20-page safety limit/
  );
});
