import test from "node:test";
import assert from "node:assert/strict";
import { runIndependentLlmAgents } from "../src/llm-agents.js";

function geminiResponse(direction = "BUY") {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({
      direction, confidence: 80, evidence: ["test evidence"], veto: false
    }) }] } }]
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("LLM swarm safely stays disabled when no key is configured", async () => {
  const result = await runIndependentLlmAgents({}, { apiKey: "" });
  assert.equal(result.enabled, false);
  assert.equal(result.decision, "HOLD");
  assert.equal(result.status, "NOT_CONFIGURED");
});

test("six Gemini roles run together and require four matching votes", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return geminiResponse(calls <= 4 ? "BUY" : "HOLD");
  };
  try {
    const result = await runIndependentLlmAgents({ market: "EURUSD" }, { apiKey: "test-key", requestIntervalMs: 0 });
    assert.equal(calls, 6);
    assert.equal(result.status, "COMPLETE");
    assert.equal(result.agents.length, 6);
    assert.deepEqual(result.agents.map(agent => agent.role).sort(),
      ["contrarian", "macro", "market_structure", "quant", "risk", "technical"].sort());
    assert.equal(result.decision, "BUY");
    assert.equal(result.votes.buy, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("transient Gemini 429 is retried and all six agents can complete", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response("quota busy", { status: 429 });
    return geminiResponse("BUY");
  };
  try {
    const result = await runIndependentLlmAgents({ market: "BTCUSD" }, {
      apiKey: "test-key", requestIntervalMs: 0, retryCount: 2, retryBaseDelayMs: 0
    });
    assert.equal(calls, 7);
    assert.equal(result.status, "COMPLETE");
    assert.equal(result.decision, "BUY");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("persistent Gemini failure forces HOLD even when other five agents agree", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls <= 3) return new Response("quota", { status: 429 });
    return geminiResponse("BUY");
  };
  try {
    const result = await runIndependentLlmAgents({ market: "BTCUSD" }, {
      apiKey: "test-key", requestIntervalMs: 0, retryCount: 2, retryBaseDelayMs: 0
    });
    assert.equal(result.status, "PARTIAL");
    assert.equal(result.decision, "HOLD");
    assert.equal(result.agents.filter(agent => agent.error).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
