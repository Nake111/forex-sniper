import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("historical bid/ask journal preserves provider quote evidence append-only", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forex-quote-history-"));
  const path = join(directory, "quotes.jsonl");
  process.env.QUOTE_HISTORY_PATH = path;
  const journal = await import("../src/historical-quote-journal.js?test=" + Date.now());
  try {
    const receivedAt = 1_800_000_000_000;
    journal.recordHistoricalQuote("EURUSD", {
      symbol: "EUR/USD", bid: 1.1, ask: 1.1002,
      timestamp: receivedAt - 500, receivedAt,
      timestampQuality: "PROVIDER_TIMESTAMP",
      source: "Test provider", venue: "Test venue", tradeable: true
    }, receivedAt);
    journal.recordHistoricalQuote("BTCUSD", {
      symbol: "BTC/USD", bid: null, ask: null,
      timestamp: null, source: "Unavailable provider"
    }, receivedAt);
    await journal.flushHistoricalQuotes();

    const rows = (await readFile(path, "utf8")).trim().split("\\n").map(JSON.parse);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].bid, 1.1);
    assert.equal(rows[0].ask, 1.1002);
    assert.equal(rows[0].spread, 0.0002);
    assert.equal(rows[0].providerTimestamp, receivedAt - 500);
    assert.equal(rows[0].receivedAt, receivedAt);
    assert.equal(rows[0].validation.valid, true);
    assert.equal(rows[1].bid, null);
    assert.equal(rows[1].ask, null);
    assert.equal(rows[1].validation.valid, false);
  } finally {
    delete process.env.QUOTE_HISTORY_PATH;
    await rm(directory, { recursive: true, force: true });
  }
});
