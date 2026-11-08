import test from "node:test";
import assert from "node:assert/strict";
import { runIndependentLlmAgents } from "../src/llm-agents.js";

const roles = ["technical", "market_structure", "quant", "macro", "risk", "contrarian"];
function geminiResponse(overrides = {}) {
  const agents = roles.map((role, index) => ({
    role,
    direction: index < 4 ? "BUY" : "HOLD",
    confidence: 80,
    evidence: ["test evidence"],
    veto: false,
    ...overrides[role]
  }));
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ agents }) }] } }]
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("LLM panel safely stays disabled when no key is configured", async () => {
  const result = await runIndependentLlmAgents({}, { apiKey: "" });
  assert.equal(result.enabled, false);
  assert.equal(result.decision, "HOLD");
  assert.equal(result.status, "NOT_CONFIGURED");
});

test("six specialist roles are confirmed in one Gemini request", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return geminiResponse(); };
  try {
    const result = await runIndependentLlmAgents({ market: "EURUSD" }, { apiKey: "test-key", timeoutMs: 2000 });
    assert.equal(calls, 1);
    assert.equal(result.status, "COMPLETE");
    assert.equal(result.mode, "single-request-six-role-panel");
    assert.equal(result.agents.length, 6);
    assert.deepEqual(result.agents.map(agent => agent.role), roles);
    assert.equal(result.decision, "BUY");
    assert.equal(result.votes.buy, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a Gemini timeout is reported without fabricated specialist votes", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new DOMException("timed out", "TimeoutError"); };
  try {
    const result = await runIndependentLlmAgents({ market: "BTCUSD" }, { apiKey: "test-key", timeoutMs: 10 });
    assert.equal(result.status, "TIMEOUT");
    assert.equal(result.decision, "HOLD");
    assert.equal(result.agents.length, 6);
    assert.equal(result.agents.every(agent => agent.veto && agent.direction === "HOLD"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("incomplete six-role response is reported as unavailable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ agents: [{ role: "technical", direction: "BUY", confidence: 90, evidence: ["x"], veto: false }] }) }] } }]
  }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const result = await runIndependentLlmAgents({ market: "XAUUSD" }, { apiKey: "test-key" });
    assert.equal(result.status, "ERROR");
    assert.equal(result.decision, "HOLD");
    assert.equal(result.agents.length, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
