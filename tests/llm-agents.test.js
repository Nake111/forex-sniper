import test from "node:test";
import assert from "node:assert/strict";
import { runIndependentLlmAgents } from "../src/llm-agents.js";
test("LLM swarm safely stays disabled when no key is configured", async () => {
  const result = await runIndependentLlmAgents({}, { apiKey: "" });
  assert.equal(result.enabled, false);
  assert.equal(result.decision, "HOLD");
  assert.equal(result.status, "NOT_CONFIGURED");
});
