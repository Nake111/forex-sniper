# Forex Sniper Second Brain

The Second Brain is a persistent research journal, not a new source of market prices and not an autonomous execution system.

## Memory layers
1. **Market memory** — closed-candle snapshots for M5/M15/H1/H4, trend regime, momentum, VWAP, POC, BOS and liquidity-sweep state.
2. **Strategy memory** — the five VWAP strategy votes and consensus on each analysis.
3. **Agent memory** — deterministic specialist votes and the optional six-role Gemini review status.
4. **Risk memory** — calendar risk and stale-data flags are recorded alongside the decision.
5. **Outcome memory** — a paper BUY/SELL with a valid entry plan remains PENDING until a later candle reaches its stop or target. If both are touched in one candle, the outcome is marked AMBIGUOUS rather than guessing which was first.

## Storage and learning
Records are stored in `data/second-brain.jsonl`. The scheduled GitHub Actions workflow restores and saves this file with a dedicated cache so recent memory survives workflow runs. The journal is capped at 3,000 records. It is not a substitute for a database and cache retention/eviction can still remove old history.

The system reports observed paper win/loss counts only. It does not automatically alter thresholds from a small sample. Strategy quality should be evaluated on a chronological holdout with spread, slippage and execution assumptions before changing live rules.

## Signal display contract
Only a validated BUY or SELL with a complete risk plan is an actionable signal. HOLD, missing data, disagreement, stale candles, high event risk, or invalid reward/risk must never be converted into a trade just to satisfy a display preference. When there is no valid trade, the signal publisher should emit no BUY/SELL alert.
