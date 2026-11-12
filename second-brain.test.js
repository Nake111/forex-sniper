import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { updateSecondBrain } from "./src/second-brain.js";

test("Second Brain records an executable signal and resolves its target from later candles", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sniper-brain-"));
  const path = join(dir, "ledger.jsonl");
  try {
    const first = [{ timestamp: 1000, open: 99, high: 101, low: 98.5, close: 100 }];
    await updateSecondBrain({ path, market: "EURUSD", signal: "BUY", plan: { entry: 100, stopLoss: 98, takeProfit: 104, riskReward: "1:2" }, candles: first, now: 2000 });
    const result = await updateSecondBrain({ path, market: "EURUSD", signal: "HOLD", candles: [...first, { timestamp: 5000, open: 100, high: 105, low: 99, close: 104 }], now: 8000 });
    assert.equal(result.wins, 1);
    const saved = (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse);
    assert.ok(saved.some(event => event.eventType === "PAPER_OUTCOME" && event.outcome === "WIN"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("same-candle stop and target touch is marked ambiguous, not a win", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sniper-brain-"));
  const path = join(dir, "ledger.jsonl");
  try {
    const first = [{ timestamp: 1000, open: 100, high: 101, low: 99, close: 100 }];
    await updateSecondBrain({ path, market: "BTCUSD", signal: "SELL", plan: { entry: 100, stopLoss: 102, takeProfit: 96, riskReward: "1:2" }, candles: first, now: 2000 });
    const result = await updateSecondBrain({ path, market: "BTCUSD", signal: "HOLD", candles: [...first, { timestamp: 5000, open: 100, high: 103, low: 95, close: 99 }], now: 8000 });
    assert.equal(result.ambiguous, 1);
    assert.equal(result.wins, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("paper signal timeout is resolved after 180 subsequent closed M5 candles", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sniper-brain-"));
  const path = join(dir, "ledger.jsonl");
  try {
    const candles = Array.from({ length: 182 }, (_, i) => ({
      timestamp: 1_000 + i * 300,
      open: 100, high: 101, low: 99, close: 100
    }));
    await updateSecondBrain({
      path, market: "EURUSD", signal: "BUY",
      plan: { entry: 100, stopLoss: 98, takeProfit: 104, riskReward: "1:2" },
      strategyAttribution: { strategyId: "CORE", session: "LONDON" },
      candles: candles.slice(0, 1), now: 2_000
    });
    const result = await updateSecondBrain({
      path, market: "EURUSD", signal: "NO TRADE", candles, now: 60_000_000
    });
    assert.equal(result.timeouts, 1);
    const saved = (await readFile(path, "utf8")).trim().split("\\n").map(JSON.parse);
    const signal = saved.find(event => event.eventType === "PAPER_SIGNAL");
    const outcome = saved.find(event => event.eventType === "PAPER_OUTCOME");
    assert.equal(signal.strategy.strategyId, "CORE");
    assert.equal(outcome.outcome, "TIMEOUT");
    assert.equal(outcome.barsHeld, 180);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
