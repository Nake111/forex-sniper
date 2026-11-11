import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateSecondBrain } from "./second-brain.js";

test("second brain stores a paper signal and resolves it from a later target touch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sniper-brain-"));
  const path = join(dir, "memory.jsonl");
  try {
    const first = await updateSecondBrain({
      market: "EURUSD", path, now: 1000,
      candles: [{ timestamp: 900, open: 1.1, high: 1.101, low: 1.099, close: 1.1 }],
      signal: "BUY", plan: { entry: 1.1, stopLoss: 1.09, takeProfit: 1.12, riskReward: "1:2" },
      vwap: { signal: "BUY", buys: 3, sells: 0, strategies: [] }
    });
    assert.equal(first.pending, 1);
    const second = await updateSecondBrain({
      market: "EURUSD", path, now: 2000,
      candles: [{ timestamp: 1500, open: 1.1, high: 1.121, low: 1.095, close: 1.115 }]
    });
    assert.equal(second.wins, 1);
    assert.equal(second.pending, 0);
    const saved = (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(saved[0].outcome, "WIN");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("second brain marks same-candle stop and target touches ambiguous", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sniper-brain-"));
  const path = join(dir, "memory.jsonl");
  try {
    await updateSecondBrain({
      market: "EURUSD", path, now: 1000, signal: "BUY",
      plan: { entry: 1.1, stopLoss: 1.09, takeProfit: 1.12, riskReward: "1:2" }
    });
    const result = await updateSecondBrain({
      market: "EURUSD", path, now: 2000,
      candles: [{ timestamp: 1500, open: 1.1, high: 1.121, low: 1.089, close: 1.1 }]
    });
    assert.equal(result.ambiguous, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
