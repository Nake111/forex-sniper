import test from "node:test";
import assert from "node:assert/strict";
import { parsePublicIdeaFeed, summarizePublicTraderEvidence, fetchPublicTraderEvidence } from "./public-trader-signals.js";

const now = Date.parse("2026-11-12T12:00:00Z");
const feed = `<rss><channel>
<item><title>EUR/USD bullish BUY outlook</title><description>Long setup</description><pubDate>Thu, 12 Nov 2026 11:30:00 GMT</pubDate><link>https://ideas.example.com/eurusd-long</link></item>
<item><title>EURUSD bearish SELL view</title><description>Short setup</description><pubDate>Thu, 12 Nov 2026 11:40:00 GMT</pubDate><link>https://ideas.example.com/eurusd-short</link></item>
<item><title>EUR/USD BUY old idea</title><description>Long</description><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate><link>https://ideas.example.com/old</link></item>
</channel></rss>`;

test("parses only fresh, same-host public ideas with unambiguous direction", () => {
  const ideas = parsePublicIdeaFeed(feed, { market: "EURUSD", sourceUrl: "https://ideas.example.com/feed.xml", now });
  assert.equal(ideas.length, 2);
  assert.equal(ideas[0].direction, "BUY");
  assert.equal(ideas[0].traderIdentityVerified, false);
});

test("rejects external article links and ambiguous direction", () => {
  const xml = `<rss><item><title>EURUSD bullish or bearish?</title><pubDate>Thu, 12 Nov 2026 11:30:00 GMT</pubDate><link>https://other.example/idea</link></item></rss>`;
  assert.deepEqual(parsePublicIdeaFeed(xml, { market: "EURUSD", sourceUrl: "https://ideas.example.com/feed", now }), []);
});

test("consensus is advisory and cannot override validation", () => {
  const ideas = parsePublicIdeaFeed(feed, { market: "EURUSD", sourceUrl: "https://ideas.example.com/feed.xml", now });
  const summary = summarizePublicTraderEvidence(ideas);
  assert.equal(summary.consensus, "MIXED_OR_NONE");
  assert.equal(summary.mayOverrideValidation, false);
});

test("missing feeds are explicitly unconfigured", async () => {
  const result = await fetchPublicTraderEvidence("BTCUSD", { feedUrls: [] });
  assert.equal(result.status, "NOT_CONFIGURED");
  assert.equal(result.mayOverrideValidation, false);
});
