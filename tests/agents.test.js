import test from "node:test";
import assert from "node:assert/strict";
import { runMarketIntelligenceAgent } from "../src/market-intelligence-agent.js";
import { runSignalApprovalAgent } from "../src/signal-approval-agent.js";

function frame(direction = "BULLISH") {
  const bullish = direction === "BULLISH";
  return {
    regime: bullish ? "BULL_TREND" : "BEAR_TREND",
    close: bullish ? 101 : 99, ema20: bullish ? 100.5 : 99.5, ema50: 100,
    atr14: 1, squeeze: { state: "NO_SQUEEZE", momentum: bullish ? 0.5 : -0.5, direction: bullish ? "BULLISH_STRENGTHENING" : "BEARISH_STRENGTHENING" },
    lastCandle: { open: bullish ? 100 : 100, high: bullish ? 102 : 100.5, low: bullish ? 99.8 : 98, close: bullish ? 101.8 : 98.2 },
    cvd: { direction: bullish ? "BUYING" : "SELLING", slope: bullish ? 1 : -1 },
    obv: { direction: bullish ? "BUYING" : "SELLING" },
    mfi14: bullish ? 60 : 40
  };
}

test("EUR/USD agent requires HTF majority and a confirming M5 close", () => {
  const frames = { M5: frame("BULLISH"), M15: frame("BULLISH"), H1: frame("BULLISH"), H4: frame("BEARISH") };
  const review = runMarketIntelligenceAgent({ market: "EURUSD", frames, quote: { spread: 0.0001 } });
  assert.equal(review.direction, "BUY");
  assert.equal(review.approved, true);
  assert.equal(review.m5.confirmed, true);
});

test("BTC/USD agent blocks an active H1 squeeze and accepts directional release", () => {
  const frames = { M5: frame(), M15: frame(), H1: frame() };
  frames.H1.squeeze = { state: "SQUEEZE_ON", momentum: 0.1, direction: "BULLISH_STRENGTHENING" };
  assert.equal(runMarketIntelligenceAgent({ market: "BTCUSD", frames }).approved, false);
  frames.H1.squeeze = { state: "SQUEEZE_RELEASED", momentum: 0.5, direction: "BULLISH_STRENGTHENING" };
  const released = runMarketIntelligenceAgent({ market: "BTCUSD", frames });
  assert.equal(released.approved, true);
  assert.equal(released.direction, "BUY");
  frames.H1.squeeze = { state: "NO_SQUEEZE", previousState: null, momentum: 0.6, direction: "BULLISH_STRENGTHENING" };
  assert.equal(runMarketIntelligenceAgent({ market: "BTCUSD", frames }).approved, false);
  frames.H1.squeeze = { state: "NO_SQUEEZE", previousState: "SQUEEZE_ON", momentum: 0.6, direction: "BULLISH_STRENGTHENING" };
  assert.equal(runMarketIntelligenceAgent({ market: "BTCUSD", frames }).approved, true);
});

test("Gold upcoming event is labelled separately from active high-impact risk", () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  const frames = { M5: frame(), M15: frame(), H1: frame() };
  const upcoming = runMarketIntelligenceAgent({
    market: "XAUUSD", frames, now,
    macro: { calendar: { status: "AVAILABLE", risk: { status: "NORMAL", activeEvents: [], nextEvents: [] } },
      goldMacro: { calendar: { events: [{ name: "CPI", timestamp: now + 20 * 60_000 }] } } }
  });
  assert.equal(upcoming.eventRisk.status, "UPCOMING_HIGH");
  assert.equal(upcoming.eventRisk.blocksNewEntry, true);
  assert.equal(upcoming.eventRisk.activeHighImpactEvents.length, 0);
  assert.equal(upcoming.eventRisk.upcomingHighImpactEvents.length, 1);

  const active = runMarketIntelligenceAgent({
    market: "XAUUSD", frames, now,
    macro: { calendar: { status: "AVAILABLE", risk: { status: "NORMAL", activeEvents: [], nextEvents: [] } },
      goldMacro: { calendar: { events: [{ name: "CPI", timestamp: now - 5 * 60_000 }] } } }
  });
  assert.equal(active.eventRisk.status, "HIGH");
  assert.equal(active.eventRisk.activeHighImpactEvents.length, 1);
});

test("Gold locks a primary-calendar high-impact event within 30 minutes as upcoming, not active", () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  const frames = { M5: frame(), M15: frame(), H1: frame() };
  const review = runMarketIntelligenceAgent({
    market: "XAUUSD", frames, now,
    macro: { calendar: { status: "AVAILABLE", risk: { status: "NORMAL", activeEvents: [],
      nextEvents: [{ name: "CPI", impact: "HIGH", scheduledAt: new Date(now + 10 * 60_000).toISOString() }] } } }
  });
  assert.equal(review.eventRisk.status, "UPCOMING_HIGH");
  assert.equal(review.eventRisk.activeHighImpactEvents.length, 0);
  assert.equal(review.eventRisk.upcomingHighImpactEvents[0].withinProtectionWindow, true);
  assert.equal(review.eventRisk.blocksNewEntry, true);
});

test("Gold distinguishes recent headline caution from an unavailable secondary calendar", () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  const frames = { M5: frame(), M15: frame(), H1: frame() };
  const review = runMarketIntelligenceAgent({
    market: "XAUUSD", frames, now,
    macro: {
      calendar: { status: "AVAILABLE", risk: { status: "NORMAL", activeEvents: [], nextEvents: [] } },
      goldMacro: { calendar: { unavailable: "Official calendar parser found no events" } },
      headlines: [{ title: "High impact inflation report", date: new Date(now - 5 * 60_000).toISOString() }]
    }
  });
  assert.equal(review.eventRisk.status, "HEADLINE_CAUTION");
  assert.equal(review.eventRisk.secondaryCalendarStatus, "UNAVAILABLE — primary ShowMyTrades calendar still evaluated");
  assert.equal(review.eventRisk.activeHighImpactEvents.length, 0);
  assert.equal(review.eventRisk.blocksNewEntry, true);
});

test("approval agent rejects missing quote and accepts only complete paper checks", () => {
  const marketReview = { market: "EURUSD", direction: "BUY", approved: true, blockers: [] };
  const plan = { entry: 1.1, stopLoss: 1.099, takeProfit: 1.102, riskRewardValue: 2, entryTriggerConfirmed: true };
  const base = { candidate: "BUY", marketReview, plan, quote: { bid: 1.1, ask: 1.1001 }, quoteValidation: { valid: true, spread: 0.0001 }, entryAtr: 0.01 };
  assert.equal(runSignalApprovalAgent({ ...base, quote: null }).approved, false);
  assert.equal(runSignalApprovalAgent(base).decision, "BUY");
});
