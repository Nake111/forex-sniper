import test from "node:test";
import assert from "node:assert/strict";
import { runMarketIntelligenceAgent } from "./market-intelligence-agent.js";

const candle = (open, high, low, close) => ({ open, high, low, close });
const frame = (direction, lastCandle = candle(100, 102, 98, 101)) => ({
  close: direction === "BUY" ? 102 : 98,
  ema20: direction === "BUY" ? 101 : 99,
  ema50: 100,
  regime: direction === "BUY" ? "BULL_TREND" : "BEAR_TREND",
  atr14: 1,
  atrBaseline: 1,
  lastCandle,
  cvd: { direction: "FLAT" },
  obv: { direction: "FLAT" },
  mfi14: 50
});

test("EURUSD requires a verifiable spread/ATR and a closed bearish M5 candle for SELL", () => {
  const frames = {
    M5: frame("SELL", candle(100, 101, 98, 98.2)),
    M15: frame("SELL"), H1: frame("SELL"), H4: frame("BUY")
  };
  const missingQuote = runMarketIntelligenceAgent({ market: "EURUSD", frames });
  assert.equal(missingQuote.approved, false);
  assert.ok(missingQuote.blockers.some(x => x.includes("spread/ATR cannot be verified")));
  const validQuote = runMarketIntelligenceAgent({
    market: "EURUSD", frames, quote: { spread: 0.05 }
  });
  assert.equal(validQuote.direction, "SELL");
  assert.equal(validQuote.m5.confirmed, true);
  assert.equal(validQuote.approved, true);
});

test("BTCUSD fails closed when H1 squeeze state is unavailable", () => {
  const frames = {
    M5: frame("BUY"), M15: frame("BUY"),
    H1: { ...frame("BUY"), squeeze: { state: "INSUFFICIENT_DATA", momentum: null, direction: "N/A" } }
  };
  const review = runMarketIntelligenceAgent({ market: "BTCUSD", frames });
  assert.equal(review.approved, false);
  assert.ok(review.blockers.some(x => x.includes("squeeze state is unavailable")));
});

test("BTCUSD does not treat an unconfirmed NO_SQUEEZE state as a release", () => {
  const frames = {
    M5: frame("BUY"), M15: frame("BUY"),
    H1: { ...frame("BUY"), squeeze: { state: "NO_SQUEEZE", previousState: null, momentum: 1, direction: "BULLISH_STRENGTHENING" } }
  };
  const review = runMarketIntelligenceAgent({ market: "BTCUSD", frames });
  assert.equal(review.approved, false);
  assert.ok(review.blockers.some(x => x.includes("release is not confirmed")));
});

test("Gold headline caution is not an automatic veto without elevated volatility", () => {
  const frames = { M5: frame("SELL", candle(100, 101, 98, 98.2)), H1: frame("SELL"), M15: frame("SELL") };
  const macro = { calendar: { status: "AVAILABLE", risk: { status: "NORMAL", activeEvents: [], nextEvents: [] } },
    headlines: [{ title: "Recent headline", date: new Date( Date.now() - 60_000).toISOString() }] };
  const review = runMarketIntelligenceAgent({ market: "XAUUSD", frames, macro });
  assert.equal(review.eventRisk.status, "HEADLINE_CAUTION");
  assert.equal(review.eventRisk.volatility.atrRatio, 1);
  assert.equal(review.eventRisk.blocksNewEntry, false);
});

test("Gold headline caution retains a veto when H1 volatility is elevated", () => {
  const frames = { M5: frame("SELL", candle(100, 101, 98, 98.2)), H1: { ...frame("SELL"), atr14: 2, atrBaseline: 1 }, M15: frame("SELL") };
  const macro = { calendar: { status: "AVAILABLE", risk: { status: "NORMAL", activeEvents: [], nextEvents: [] } },
    headlines: [{ title: "Recent headline", date: new Date(Date.now() - 60_000).toISOString() }] };
  const review = runMarketIntelligenceAgent({ market: "XAUUSD", frames, macro });
  assert.equal(review.eventRisk.blocksNewEntry, true);
  assert.match(review.eventRisk.reason, /elevated H1 volatility/);
});


test("Gold retains headline veto when H1 volatility baseline is unavailable", () => {
  const frames = { M5: frame("SELL", candle(100, 101, 98, 98.2)), H1: { ...frame("SELL"), atrBaseline: null }, M15: frame("SELL") };
  const macro = { calendar: { status: "AVAILABLE", risk: { status: "NORMAL", activeEvents: [], nextEvents: [] } },
    headlines: [{ title: "Recent headline", date: new Date(Date.now() - 60_000).toISOString() }] };
  const review = runMarketIntelligenceAgent({ market: "XAUUSD", frames, macro });
  assert.equal(review.eventRisk.blocksNewEntry, true);
  assert.match(review.eventRisk.reason, /volatility ratio is unavailable/);
});
