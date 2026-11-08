import test from "node:test";
import assert from "node:assert/strict";
import { runIndependentLlmAgents } from "./llm-agents.js";

const roles = ["technical", "market_structure", "quant", "macro", "risk", "contrarian"];

test("Gemini accepts a complete six-role panel", async () => {
  const previousFetch = globalThis.fetch;
  const agents = roles.map((role, index) => ({
    role,
    direction: index < 4 ? "BUY" : index === 4 ? "SELL" : "HOLD",
    confidence: 70,
    evidence: ["test evidence"],
    veto: false
  }));
  globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ agents }) }] } }]
  }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const result = await runIndependentLlmAgents({ market: "EURUSD" }, { apiKey: "test-key", timeoutMs: 2000 });
    assert.equal(result.status, "COMPLETE");
    assert.equal(result.agents.length, 6);
    assert.equal(result.decision, "BUY");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Gemini timeout is reported honestly without fabricated agent votes", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const error = new Error("deadline exceeded");
    error.name = "TimeoutError";
    throw error;
  };
  try {
    const result = await runIndependentLlmAgents({ market: "BTCUSD" }, { apiKey: "test-key", timeoutMs: 2000 });
    assert.equal(result.status, "TIMEOUT");
    assert.equal(result.agents.length, 0);
    assert.equal(result.decision, null);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
