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

test("local HIGH macro risk blocks a Gemini BUY consensus", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => geminiResponse();
  try {
    const result = await runIndependentLlmAgents({
      market: "EURUSD",
      macro: { eventRisk: "HIGH" }
    }, { apiKey: "test-key", timeoutMs: 2000 });
    assert.equal(result.status, "COMPLETE");
    assert.equal(result.votes.buy, 4);
    assert.equal(result.decision, "HOLD");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stale data forces Gemini review to HOLD", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => geminiResponse();
  try {
    const result = await runIndependentLlmAgents({
      market: "BTCUSD",
      macro: { eventRisk: "NORMAL", dataStale: true, staleTimeframes: ["M5"] }
    }, { apiKey: "test-key", timeoutMs: 2000 });
    assert.equal(result.decision, "HOLD");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("XAUUSD fails closed when macro risk is unknown", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => geminiResponse();
  try {
    const result = await runIndependentLlmAgents({
      market: "XAUUSD",
      macro: { eventRisk: "UNKNOWN" }
    }, { apiKey: "test-key", timeoutMs: 2000 });
    assert.equal(result.decision, "HOLD");
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
    assert.equal(result.decision, null);
    assert.equal(result.agents.length, 0);
    assert.equal(result.votes, null);
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
    assert.equal(result.decision, null);
    assert.equal(result.agents.length, 0);
    assert.equal(result.votes, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gemini JSON parser repairs trailing commas without altering quoted text", async () => {
  const { extractJson } = await import("../src/llm-agents.js");
  const parsed = extractJson('{"agents":[{"role":"technical","evidence":["literal ,} text"],}],}');
  assert.equal(parsed.agents[0].evidence[0], "literal ,} text");
});

test("Gemini JSON parser accepts fenced JSON and nested objects", async () => {
  const { extractJson } = await import("../src/llm-agents.js");
  const parsed = extractJson('```json\n{"agents":[{"role":"technical","meta":{"note":"brace } inside string"}}]}\n```');
  assert.equal(parsed.agents[0].meta.note, "brace } inside string");
});

test("Gemini JSON parser rejects truncated responses with a clear error", async () => {
  const { extractJson } = await import("../src/llm-agents.js");
  assert.throws(() => extractJson('{"agents":[{"role":"technical"}]'), /incomplete JSON/);
});
