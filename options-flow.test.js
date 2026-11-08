import test from "node:test";
import assert from "node:assert/strict";
import { fetchBtcOptionsWalls, summarizeOptionsContext } from "./src/options-flow.js";

function fakeFetch(payloads) {
  let index = 0;
  return async () => ({ ok: true, json: async () => ({ result: payloads[index++] }) });
}

test("builds nearest-expiry call/put walls and max pain from options OI", async () => {
  const now = Date.UTC(2026, 10, 8);
  const expiry = now + 7 * 86_400_000;
  const instruments = [
    { instrument_name: "BTC-15NOV26-90000-C", expiration_timestamp: expiry, strike: 90000, option_type: "call" },
    { instrument_name: "BTC-15NOV26-90000-P", expiration_timestamp: expiry, strike: 90000, option_type: "put" },
    { instrument_name: "BTC-15NOV26-100000-C", expiration_timestamp: expiry, strike: 100000, option_type: "call" },
    { instrument_name: "BTC-15NOV26-100000-P", expiration_timestamp: expiry, strike: 100000, option_type: "put" }
  ];
  const summaries = [
    { instrument_name: "BTC-15NOV26-90000-C", underlying_price: 95000, mark_iv: 60, open_interest: 5, volume: 2 },
    { instrument_name: "BTC-15NOV26-90000-P", underlying_price: 95000, mark_iv: 60, open_interest: 30, volume: 1 },
    { instrument_name: "BTC-15NOV26-100000-C", underlying_price: 95000, mark_iv: 55, open_interest: 40, volume: 10 },
    { instrument_name: "BTC-15NOV26-100000-P", underlying_price: 95000, mark_iv: 55, open_interest: 4, volume: 3 }
  ];
  const snapshot = await fetchBtcOptionsWalls({ fetchImpl: fakeFetch([instruments, summaries]), now });
  assert.equal(snapshot.callWall.strike, 100000);
  assert.equal(snapshot.putWall.strike, 90000);
  assert.equal(snapshot.volumeWall.strike, 100000);
  assert.equal(snapshot.levels.length, 2);
  assert.ok(snapshot.grossGammaExposureProxy > 0);
  assert.equal(summarizeOptionsContext(snapshot, 95000).bias, "BETWEEN_WALLS");
});

test("fails closed when provider returns no valid active contracts", async () => {
  await assert.rejects(
    fetchBtcOptionsWalls({ fetchImpl: fakeFetch([[], []]), now: Date.UTC(2026, 10, 8) }),
    /No valid active BTC options/
  );
});
