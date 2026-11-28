import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { buildBinanceBtcOrderFlow, isDirectExecution } from "./binance-btc-order-flow.js";

const now = 1_800_000_000_000;

function mockFetch() {
  const routes = [
    {
      match: "/api/v3/aggTrades",
      body: [
        { q: "2", T: now - 2_000, m: false },
        { q: "1", T: now - 1_000, m: true }
      ]
    },
    {
      match: "/fapi/v1/aggTrades",
      body: [
        { q: "4", T: now - 2_000, m: false },
        { q: "3", T: now - 1_000, m: true }
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
    error => error.code === "WARMING_UP" && error.baselineOpenInterest.value === 101
  );
});

test("rejects malformed trades rather than guessing aggressor direction", async () => {
  const fetchImpl = async url => {
    if (url.includes("/api/v3/aggTrades")) {
      return { ok: true, json: async () => [{ q: "1", T: now - 1_000 }] };
    }
    if (url.includes("/fapi/v1/aggTrades")) {
      return { ok: true, json: async () => [{ q: "1", T: now - 1_000, m: false }] };
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

test("fails closed when Binance hits the aggregate-trade response cap", async () => {
  const cappedTrades = Array.from({ length: 1_000 }, (_, index) => ({
    q: "0.001",
    T: now - 1_000 + index,
    m: false
  }));
  const fetchImpl = async url => {
    if (url.includes("/api/v3/aggTrades")) return { ok: true, json: async () => cappedTrades };
    if (url.includes("/fapi/v1/aggTrades")) return { ok: true, json: async () => [{ q: "1", T: now - 1_000, m: false }] };
    if (url.includes("/fapi/v1/openInterest")) return { ok: true, json: async () => ({ openInterest: "100", time: now }) };
    return { ok: true, json: async () => ({ lastFundingRate: "0.0001" }) };
  };
  await assert.rejects(
    buildBinanceBtcOrderFlow({
      fetchImpl,
      now,
      baselineOpenInterest: { value: 99, timestamp: now - 60_000 }
    }),
    /reached the 1,000-record limit/
  );
});
