import test from "node:test";
import assert from "node:assert/strict";
import { evaluateBtcSignalQuality, fetchBtcOrderFlowEvidence } from "./btc-signal-quality.js";

function fixture(direction = "BUY") {
  const bullish = direction === "BUY";
  const frames = {
    M5: { close: 100, atr14: 2, structure: { bos: bullish ? "BULLISH" : "BEARISH" } },
    M15: { lastCandle: { open: bullish ? 99 : 101, high: 102, low: 98, close: bullish ? 101.5 : 98.5 } },
    H1: { regime: bullish ? "BULL_TREND" : "BEAR_TREND", squeeze: {
      state: "SQUEEZE_RELEASED", previousState: "SQUEEZE_ON",
      momentum: bullish ? 1 : -1,
      direction: bullish ? "BULLISH_STRENGTHENING" : "BEARISH_STRENGTHENING"
    } },
    H4: { regime: bullish ? "BULL_TREND" : "BEAR_TREND" }
  };
  const now = Date.now();
  return {
    direction, frames,
    microstructure: { status: "LIVE", direction: "NEUTRAL", source: "Coinbase spot" },
    orderFlow: { status: "LIVE", symbol: "BTC-USD", timestamp: now, ageMs: 1000, source: "test provider",
      spot: { buyVolume: 12, sellVolume: 4, cvd: bullish ? 8 : -8 },
      perpetual: { buyVolume: 15, sellVolume: 5, cvd: bullish ? 10 : -10, openInterestChangePct: 0.5, fundingRate: 0.0001 } },
    quoteValidation: { valid: true, spread: 0.1 },
    quote: { bid: 100.1, ask: 100.2 },
    plan: { entryTriggerConfirmed: true, riskRewardValue: 2.2 }
  };
}

test("approves only a fully confirmed BTC setup", () => {
  const input = fixture();
  const result = evaluateBtcSignalQuality(input);
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.blockers, []);
});

test("requires a real H1 squeeze release, not unavailable or merely no-squeeze", () => {
  const input = fixture();
  input.frames.H1.squeeze.state = "INSUFFICIENT_DATA";
  assert.ok(evaluateBtcSignalQuality(input).blockers.some(x => x.includes("squeeze-release")));
  input.frames.H1.squeeze.state = "NO_SQUEEZE";
  assert.ok(evaluateBtcSignalQuality(input).blockers.some(x => x.includes("squeeze-release")));
});

test("requires both spot and perpetual CVD plus expanding open interest", () => {
  const input = fixture();
  input.orderFlow.spot.cvd = -1;
  input.orderFlow.perpetual.openInterestChangePct = -0.1;
  const result = evaluateBtcSignalQuality(input);
  assert.ok(result.blockers.some(x => x.includes("spot CVD")));
  assert.ok(result.blockers.some(x => x.includes("open interest")));
});

test("rejects stale or missing order-flow data", () => {
  const input = fixture();
  input.orderFlow.status = "UNAVAILABLE";
  assert.ok(evaluateBtcSignalQuality(input).blockers.some(x => x.includes("order-flow evidence")));
});

test("rejects countertrend tape, weak structure, wide spread and chased entries", () => {
  const input = fixture();
  input.microstructure.direction = "SELL";
  input.frames.M5.structure.bos = "NONE";
  input.quoteValidation.spread = 1;
  input.quote.ask = 104;
  const result = evaluateBtcSignalQuality(input);
  assert.ok(result.blockers.some(x => x.includes("tape opposes")));
  assert.ok(result.blockers.some(x => x.includes("BOS/liquidity")));
  assert.ok(result.blockers.some(x => x.includes("spread/ATR")));
  assert.ok(result.blockers.some(x => x.includes("chasing")));
});

test("rejects weak risk reward and crowded funding", () => {
  const input = fixture();
  input.plan.riskRewardValue = 1.5;
  input.orderFlow.perpetual.fundingRate = 0.002;
  const result = evaluateBtcSignalQuality(input);
  assert.ok(result.blockers.some(x => x.includes("1:2")));
  assert.ok(result.blockers.some(x => x.includes("funding is crowded")));
});

test("order-flow fetch refuses unconfigured provider instead of inventing data", async () => {
  const result = await fetchBtcOrderFlowEvidence({ url: "", fetchImpl: async () => { throw new Error("must not fetch"); } });
  assert.equal(result.status, "UNAVAILABLE");
});
