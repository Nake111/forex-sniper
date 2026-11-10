import test from "node:test";
import assert from "node:assert/strict";
import { runTradingAgents, gateSignalWithAgents } from "../src/trading-agents.js";

function bullishFrames() {
  const frame = {
    regime: "BULL_TREND", macdHistogram: 1, rsi14: 60,
    supertrend: { direction: "BULLISH" },
    structure: { bos: "BULLISH", sweep: "NONE", sweepConfirmed: false, liquiditySweep: "NONE" },
    smartMoney: { orderBlocks: [] }, vwap: 99, poc: 99, close: 100,
    cvd: { direction: "BUYING" }, atr14: 1, atrBaseline: 1, adx14: 25,
    stochRsi: { direction: "BULLISH" }, cci20: 80,
    lastCandle: { open: 99, high: 101, low: 98, close: 100.8 },
    sessionContext: { primary: "LONDON", active: ["London"], breakout: "BULLISH" }
  };
  return { M5: { ...frame }, M15: { ...frame }, H1: { ...frame }, H4: { ...frame } };
}

test("11 local specialists report and aligned BUY consensus is approved", () => {
  const report = runTradingAgents({ market: "EURUSD", frames: bullishFrames(), macro: { eventRisk: "NORMAL" } });
  assert.equal(report.agentCount, 11);
  assert.equal(report.agents.length, 11);
  assert.equal(report.additionalSpecialists.length, 6);
  assert.equal(report.portfolioManager.decision, "BUY");
  assert.equal(gateSignalWithAgents("BUY", report).signal, "BUY");
});

test("all six additional specialists are separately identified", () => {
  const report = runTradingAgents({ market: "EURUSD", frames: bullishFrames(), macro: { eventRisk: "NORMAL" } });
  assert.deepEqual(report.additionalSpecialists, [
    "Higher-timeframe confluence analyst",
    "Volatility and regime analyst",
    "M5 candle-quality analyst",
    "Momentum exhaustion analyst",
    "Liquidity sweep and reclaim analyst",
    "Trading-session breakout analyst"
  ]);
});

test("new specialists require evidence and abstain when their fields are missing", () => {
  const report = runTradingAgents({
    market: "EURUSD",
    frames: { M5: {}, M15: {}, H1: {} },
    macro: { eventRisk: "NORMAL" }
  });
  assert.equal(report.agents.length, 11);
  assert.ok(report.agents.slice(5).every(agent => agent.direction === "HOLD"));
});

test("liquidity specialist only votes on a confirmed recent sweep", () => {
  const frames = bullishFrames();
  frames.M5.structure = {
    bos: "NONE", sweep: "NONE", sweepConfirmed: true,
    liquiditySweep: "BEARISH", liquiditySweepBarsAgo: 1
  };
  const report = runTradingAgents({ market: "EURUSD", frames, macro: { eventRisk: "NORMAL" } });
  const agent = report.agents.find(item => item.name === "Liquidity sweep and reclaim analyst");
  assert.equal(agent.direction, "SELL");
});

test("candle specialist rejects weak-close candles", () => {
  const frames = bullishFrames();
  frames.M5.lastCandle = { open: 99, high: 101, low: 98, close: 99.2 };
  const report = runTradingAgents({ market: "EURUSD", frames, macro: { eventRisk: "NORMAL" } });
  const agent = report.agents.find(item => item.name === "M5 candle-quality analyst");
  assert.equal(agent.direction, "HOLD");
});

test("risk manager vetoes high-impact news", () => {
  const report = runTradingAgents({ market: "BTCUSD", frames: bullishFrames(), macro: { eventRisk: "HIGH" } });
  assert.equal(report.portfolioManager.decision, "HOLD");
  assert.equal(gateSignalWithAgents("BUY", report).signal, "HOLD");
});

test("multi-agent layer never upgrades a HOLD technical signal", () => {
  const report = runTradingAgents({ market: "XAUUSD", frames: bullishFrames(), macro: { eventRisk: "NORMAL" } });
  assert.equal(gateSignalWithAgents("HOLD", report).signal, "HOLD");
});

test("risk manager vetoes stale market data", () => {
  const report = runTradingAgents({
    market: "EURUSD", frames: bullishFrames(),
    macro: { eventRisk: "NORMAL", dataStale: true }
  });
  assert.equal(report.portfolioManager.decision, "HOLD");
  assert.ok(report.riskManager.blocks.includes("STALE_MARKET_DATA"));
});
