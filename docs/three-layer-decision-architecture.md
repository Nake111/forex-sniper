# Three-layer signal decision architecture

Forex Sniper now records three distinct decisions for each market.

## Layer 1 — Signal discovery

```json
{
  "name": "SIGNAL_DISCOVERY",
  "candidate": "BUY | SELL | NO SETUP",
  "timeframes": { "M5": "BUY", "M15": "BUY", "H1": "BUY", "H4": "MIXED" }
}
```

This is the technical engine's directional candidate. Later checks must not rewrite or hide it. The timeframe fields are context, not a guarantee that all four frames agree.

## Layer 2 — Independent verification

Reports separate checks for higher-timeframe trend, M5 momentum/trigger, market structure, buyer/seller pressure, deterministic market rules, candle freshness, macro event risk and spread. Each check reports PASS, FAIL, UNAVAILABLE or ADVISORY. Optional cloud/LLM review outages are reported as UNAVAILABLE and do not independently veto a setup when deterministic validation passes.

## Layer 3 — Execution approval

Requires a valid fresh bid/ask, executable-side price, entry, stop-loss, take-profit, risk/reward and all prior approvals. It distinguishes a paper/reference signal from a broker-executable order. Broker execution remains disabled until an actual venue and account are connected and verified.

## Safety and interpretation

- A BUY/SELL candidate is not an instruction to trade.
- A rejected candidate remains visible with its blockers.
- Missing or stale required market data cannot be treated as a pass.
- Bid/ask snapshots are not full order-book depth or proof of executed buyer/seller volume.
- No order is placed by this decision pipeline.

## Strategy-family isolation

A1 HEART is a separate opening-range breakout strategy that requires its own session, volume-profile retest and absorption confirmation. It is not a universal prerequisite for unrelated trend, VWAP, SMC, or retest candidates. An unavailable or unready A1 setup is recorded as an advisory and disables only the A1 HEART setup family; it must not silently veto every BTC/USD or XAU/USD candidate. If a candidate is explicitly sourced from A1 HEART, that strategy must independently report READY in the same direction.

The weighted score advances a candidate only to the risk gate. It never relaxes provider-timestamped quote freshness, spread/ATR, closed-candle trigger, independent direction/entry verification, event-risk, stop/target geometry or minimum live-quote R:R checks. Candidate discovery and approved paper signals remain separate outputs.

The historical holdout audit is negative for all three markets. This correction fixes a strategy-routing defect; it is not evidence of profitability and does not authorize lowering thresholds or changing the frozen holdout. Evaluate the change on training data first, then commit candidate parameters before any one-time untouched holdout test. Continue paper-only operation.
