import test from "node:test";
import assert from "node:assert/strict";
import { enrichNewsWithAgentReach } from "./agent-reach-research.js";

const articles = [{
  title: "ECB policy outlook",
  source: "Example News",
  date: "2026-11-14T07:00:00Z",
  url: "https://example.com/ecb-outlook"
}];

test("Agent-Reach enriches article body as zero-vote research context", async () => {
  let invoked = false;
  const result = await enrichNewsWithAgentReach(articles, {
    market: "EURUSD",
    execFileImpl: async (command, args) => {
      invoked = command === "agent-reach" && args[0] === "read" && args[1] === articles[0].url;
      return { stdout: JSON.stringify({
        ok: true,
        items: [{ title: "ECB policy outlook", url: articles[0].url, author: "Example", published_at: articles[0].date, text: "A public article body." }]
      }) };
    }
  });
  assert.equal(invoked, true);
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.researchOnly, true);
  assert.equal(result.voteWeight, 0);
  assert.equal(result.canApproveSignal, false);
  assert.equal(result.items[0].text, "A public article body.");
});

test("Agent-Reach failure is fail-open for research and cannot affect signal safety", async () => {
  const result = await enrichNewsWithAgentReach(articles, {
    execFileImpl: async () => { throw new Error("CLI unavailable"); }
  });
  assert.equal(result.status, "UNAVAILABLE");
  assert.match(result.reason, /CLI unavailable/);
  assert.equal(result.canApproveSignal, false);
});

test("Agent-Reach can be disabled and rejects unsafe URLs", async () => {
  let invoked = false;
  const result = await enrichNewsWithAgentReach([{ ...articles[0], url: "file:///etc/passwd" }], {
    enabled: false,
    execFileImpl: async () => { invoked = true; return { stdout: "{}" }; }
  });
  assert.equal(result.status, "DISABLED");
  assert.equal(invoked, false);
});
