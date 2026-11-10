import test from "node:test";
import assert from "node:assert/strict";
import { evaluateConfirmationQuality, gateSignalWithAgents } from "./src/trading-agents.js";

function report({ support = 6, oppose = 2, risk = true, higher = "BUY", volatility = "BUY" } = {}) {
  const votes = support === 8
    ? ["BUY", "BUY", "BUY", "BUY", "BUY", "BUY", "BUY", "BUY", "SELL", "HOLD", "HOLD"]
    : support === 6
      ? ["BUY", "BUY", "BUY", "SELL", "SELL", "BUY", "BUY", "BUY", "SELL", "HOLD", "HOLD"]
      : ["BUY", "BUY", "SELL", "SELL", "SELL", "BUY", "BUY", "HOLD", "HOLD", "HOLD", "HOLD"];
  const agents = votes.map((direction, index) => ({
    name: index === 5 ? "Higher-timeframe confluence analyst"
      : index === 6 ? "Volatility and regime analyst" : `Specialist ${index + 1}`,
    direction
  }));
  agents[5].direction = higher;
  agents[6].direction = volatility;
  return {
    agents,
    riskManager: { approved: risk, blocks: risk ? [] : ["TEST_RISK_BLOCK"] },
    portfolioManager: { decision: "BUY" }
  };
}

test("six of eleven with 75% directional agreement and core/HTF alignment is GOOD", () => {
  const result = evaluateConfirmationQuality("BUY", report());
  assert.equal(result.tier, "GOOD");
  assert.equal(result.approved, true);
  assert.equal(result.supporting, 6);
  assert.equal(result.agreementPct, 75);
});

test("eight aligned specialists with strong agreement is STRONG", () => {
  const result = evaluateConfirmationQuality("BUY", report({ support: 8, oppose: 1 }));
  assert.equal(result.tier, "STRONG");
  assert.equal(result.approved, true);
});

test("weak agent agreement is rejected as HOLD", () => {
  const result = gateSignalWithAgents("BUY", report({ support: 4, oppose: 3 }));
  assert.equal(result.signal, "HOLD");
  assert.equal(result.approved, false);
  assert.ok(result.reasons.length > 0);
});

test("opposing higher timeframe confirmation blocks a candidate", () => {
  const result = gateSignalWithAgents("BUY", report({ higher: "SELL" }));
  assert.equal(result.signal, "HOLD");
  assert.ok(result.reasons.includes("Higher-timeframe confluence does not confirm"));
});

test("risk manager veto always blocks a candidate", () => {
  const result = gateSignalWithAgents("BUY", report({ risk: false }));
  assert.equal(result.signal, "HOLD");
  assert.ok(result.reasons.some(reason => reason.startsWith("Risk manager veto")));
});

test("no technical candidate remains HOLD", () => {
  const result = gateSignalWithAgents("HOLD", report());
  assert.equal(result.signal, "HOLD");
  assert.equal(result.quality, "WEAK");
});
