import test from "node:test";
import assert from "node:assert/strict";
import { finalAction, tradePlan, buildIndicativeTradePlan, pricePlanAtExecutableQuote } from "./src/trade-plan.js";

const market = { close: 1.12390, atr14: 0.000374, lastCandle: { open: 1.12370, high: 1.12400, low: 1.12360, close: 1.12390 } };
const sellMarket = { close: 1.12370, atr14: market.atr14, lastCandle: { open: 1.12400, high: 1.12410, low: 1.12360, close: 1.12370 } };

test("BUY with H1 WAIT means NO TRADE", () => {
  const plan = tradePlan("BUY", market, { status: "WAIT" });
  assert.equal(plan, null);
  assert.equal(finalAction("BUY", plan), "NO TRADE");
});
test("SELL with H1 WAIT means NO TRADE", () => {
  assert.equal(tradePlan("SELL", sellMarket, { status: "WAIT" }), null);
});
test("BUY with H1 ALIGNED creates an ATR fallback plan", () => {
  const plan = tradePlan("BUY", market, { status: "H1 ALIGNED" });
  assert.ok(plan);
  assert.ok(plan.stopLoss < plan.entry);
  assert.ok(plan.takeProfit > plan.entry);
  assert.equal(plan.riskReward, "1:2");
  assert.equal(plan.stopType, "ATR_FALLBACK");
});
test("SELL with H1 ALIGNED creates an ATR fallback plan", () => {
  const plan = tradePlan("SELL", sellMarket, { status: "H1 ALIGNED" });
  assert.ok(plan);
  assert.ok(plan.stopLoss > plan.entry);
  assert.ok(plan.takeProfit < plan.entry);
  assert.equal(plan.riskReward, "1:2");
});
test("structure stop uses swing invalidation with ATR buffer", () => {
  const plan = tradePlan("BUY", { ...market, structure: { swingLow: 1.1232, swingLowBarsAgo: 8 } }, { status: "H1 ALIGNED" });
  assert.equal(plan.stopType, "MARKET_STRUCTURE");
  assert.ok(plan.stopLoss < 1.1232);
  assert.ok(plan.riskDistance > market.atr14 * 0.8);
});
test("HOLD never creates a trade plan", () => {
  assert.equal(tradePlan("HOLD", market, { status: "H1 ALIGNED" }), null);
});
test("Missing or directionally invalid M5 entry trigger blocks a plan", () => {
  assert.equal(tradePlan("BUY", { close: market.close, atr14: market.atr14 }, { status: "H1 ALIGNED" }), null);
  assert.equal(tradePlan("BUY", sellMarket, { status: "H1 ALIGNED" }), null);
});

test("Invalid ATR or missing confirmation blocks a plan", () => {
  assert.equal(tradePlan("BUY", { ...market, atr14: 0 }, { status: "H1 ALIGNED" }), null);
  assert.equal(tradePlan("BUY", market, null), null);
});

test("prices BUY at validated ask and calculates live R:R without moving SL/TP", () => {
  const raw = buildIndicativeTradePlan("BUY", market, "EURUSD");
  const quote = { bid: 1.12391, ask: 1.12393, timestamp: 1_800_000_000_000, receivedAt: 1_800_000_000_000,
    source: "test", venue: "reference", timestampQuality: "PROVIDER_TIMESTAMP", snapshotId: "quote-buy" };
  const validation = { valid: true, snapshotId: "quote-buy", bid: quote.bid, ask: quote.ask, timestamp: quote.timestamp,
    receivedAt: quote.receivedAt, source: quote.source, venue: quote.venue, timestampQuality: quote.timestampQuality,
    ageMs: 100, checkedAt: 1_800_000_000_000 };
  const plan = pricePlanAtExecutableQuote(raw, "BUY", quote, validation, market.atr14, 1_800_000_000_000);
  assert.equal(plan.entry, quote.ask);
  assert.equal(plan.entryReference, "ASK");
  assert.equal(plan.signalReferenceEntry, market.close);
  assert.equal(plan.stopLoss, raw.stopLoss);
  assert.equal(plan.takeProfit, raw.takeProfit);
  assert.ok(Math.abs(plan.riskRewardValue - Math.abs(plan.takeProfit-plan.entry)/Math.abs(plan.entry-plan.stopLoss)) < 1e-10);
});

test("prices SELL at validated bid and rejects stale or mismatched quote snapshots", () => {
  const raw = buildIndicativeTradePlan("SELL", sellMarket, "EURUSD");
  const quote = { bid: 1.12368, ask: 1.12370, timestamp: 1_800_000_000_000, receivedAt: 1_800_000_000_000,
    source: "test", venue: "reference", timestampQuality: "PROVIDER_TIMESTAMP", snapshotId: "quote-sell" };
  const validation = { valid: true, snapshotId: "quote-sell", bid: quote.bid, ask: quote.ask, timestamp: quote.timestamp,
    receivedAt: quote.receivedAt, source: quote.source, venue: quote.venue, timestampQuality: quote.timestampQuality,
    ageMs: 100, checkedAt: 1_800_000_000_000 };
  const plan = pricePlanAtExecutableQuote(raw, "SELL", quote, validation, market.atr14, 1_800_000_000_000);
  assert.equal(plan.entry, quote.bid);
  assert.equal(plan.entryReference, "BID");
  assert.equal(pricePlanAtExecutableQuote(raw, "SELL", quote, { ...validation, ageMs: 20_000 }, market.atr14, 1_800_000_000_000), null);
  assert.equal(pricePlanAtExecutableQuote(raw, "SELL", quote, { ...validation, snapshotId: "wrong" }, market.atr14, 1_800_000_000_000), null);
});
