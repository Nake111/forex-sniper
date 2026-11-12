import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateSecondBrain } from "./second-brain.js";

test("paper journal is append-only, stores validated quote evidence, and resolves later candle outcomes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sniper-brain-"));
  const path = join(dir, "memory.jsonl");
  try {
    const quote = {
      bid: 1.1, ask: 1.1001, timestamp: 900_000, receivedAt: 900_000,
      source: "test-feed", venue: "test-venue", timestampQuality: "PROVIDER_TIMESTAMP"
    };
    const args = {
      market: "EURUSD", path, now: 901_000,
      candles: [{ timestamp: 800, open: 1.1, high: 1.101, low: 1.099, close: 1.1 }],
      signal: "BUY", candidate: "BUY",
      plan: { entry: 1.1001, stopLoss: 1.09, takeProfit: 1.12, riskReward: 2 },
      quote, quoteValidation: { valid: true, spread: 0.0001, ageMs: 1000 },
      frames: { M5: { atr14: 0.001 } }
    };
    const first = await updateSecondBrain(args);
    assert.equal(first.pending, 1);
    assert.equal(first.quoteEvidence.validation, "VALID");
    assert.equal(first.quoteEvidence.observedSpread, 0.0001);

    const duplicate = await updateSecondBrain(args);
    assert.equal(duplicate.appendedEvents, 0);
    assert.equal(duplicate.marketSignals, 1);

    const second = await updateSecondBrain({
      ...args, signal: "NO TRADE", now: 1_000_000,
      candles: [
        { timestamp: 800, open: 1.1, high: 1.101, low: 1.099, close: 1.1 },
        { timestamp: 1500, open: 1.1, high: 1.121, low: 1.095, close: 1.115 }
      ],
      quote: { ...quote, timestamp: 999_000, receivedAt: 999_000 }
    });
    assert.equal(second.wins, 1);
    assert.equal(second.pending, 0);
    const saved = (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse);
    assert.ok(saved.some(row => row.eventType === "PAPER_SIGNAL"));
    assert.ok(saved.some(row => row.eventType === "PAPER_OBSERVATION"));
    const outcome = saved.find(row => row.eventType === "PAPER_OUTCOME" && row.outcome === "WIN");
    assert.ok(outcome);
    assert.ok(outcome.grossR > 1.9);
    assert.ok(outcome.estimatedSpreadAndSlippageCostR > 0);
    assert.ok(outcome.netEstimatedRExcludingCommission < outcome.grossR);
    assert.equal(outcome.estimatedCommissionCostR, null);
    assert.equal(outcome.estimatedAllInCostR, null);
    assert.equal(outcome.netEstimatedR, null);
    assert.equal(outcome.actualFill, null);
    assert.equal(outcome.observedSlippage, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("paper journal records same-candle stop and target touches as ambiguous", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sniper-brain-"));
  const path = join(dir, "memory.jsonl");
  try {
    await updateSecondBrain({
      market: "EURUSD", path, now: 901_000,
      candles: [{ timestamp: 800, open: 1.1, high: 1.101, low: 1.099, close: 1.1 }],
      signal: "BUY", plan: { entry: 1.1, stopLoss: 1.09, takeProfit: 1.12 }
    });
    const result = await updateSecondBrain({
      market: "EURUSD", path, now: 1_000_000,
      candles: [
        { timestamp: 800, open: 1.1, high: 1.101, low: 1.099, close: 1.1 },
        { timestamp: 1500, open: 1.1, high: 1.121, low: 1.089, close: 1.1 }
      ]
    });
    assert.equal(result.ambiguous, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
