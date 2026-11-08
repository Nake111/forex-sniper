import test from "node:test";
import assert from "node:assert/strict";
import { runTradingAgents, gateSignalWithAgents } from "../src/trading-agents.js";

function bullishFrames() {
  const frame = {
    regime: "BULL_TREND", macdHistogram: 1, rsi14: 60,
    supertrend: { direction: "BULLISH" },
    structure: { bos: "BULLISH", sweep: "NONE" },
    smartMoney: { orderBlocks: [] }, vwap: 99, poc: 99, close: 100,
    cvd: { direction: "BUYING" }, atr14: 1, atrBaseline: 1
  };
  return { M5: { ...frame }, M15: { ...frame }, H1: { ...frame } };
}

test("multi-agent portfolio manager approves aligned BUY consensus", () => {
  const report = runTradingAgents({ market: "EURUSD", frames: bullishFrames(), macro: { eventRisk: "NORMAL" } });
  assert.equal(report.portfolioManager.decision, "BUY");
  assert.equal(gateSignalWithAgents("BUY", report).signal, "BUY");
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
    market: "EURUSD",
    frames: bullishFrames(),
    macro: { eventRisk: "NORMAL", dataStale: true }
  });
  assert.equal(report.portfolioManager.decision, "HOLD");
  assert.ok(report.riskManager.blocks.includes("STALE_MARKET_DATA"));
});
