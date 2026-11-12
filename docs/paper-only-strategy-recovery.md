# Paper-only strategy recovery protocol

**Status: PAPER / RESEARCH ONLY.** No broker integration, no live orders, and no automatic promotion to live execution. A successful workflow means the analysis ran; it does not mean the strategy passed.

## Baseline that must remain frozen

The 12 November 2026 chronological 30% holdout audit reported:

| Market | Trades | Win rate | Expectancy | Net R | Profit factor | Max drawdown |
|---|---:|---:|---:|---:|---:|---:|
| EURUSD | 332 | 32.53% | -0.237 R | -78.84 R | 0.71 | 105.69 R |
| BTCUSD | 337 | 34.12% | -0.178 R | -59.84 R | 0.78 | 71.27 R |
| XAUUSD | 294 | 31.97% | -0.403 R | -118.45 R | 0.58 | 125.12 R |

These are negative results. Do not tune against, re-label, or repeatedly inspect the holdout while selecting parameters. Preserve this baseline report and its source candles as an immutable comparison.

## Diagnostic questions by market

### EURUSD
- Decompose by London, New York, Sydney, Tokyo, long/short and setup family.
- The prior audit's London bucket was the only notably positive session (102 trades, 43.14% wins, +16.13 R, PF 1.25); all other sessions were negative. Treat this as a training hypothesis, not an approved live filter.
- Audit spread/ATR, entry displacement from signal close, M5 confirmation, H1 alignment, stop distance, target distance, and whether costs erase gross edge.

### BTCUSD
- Separate Sydney, Tokyo, London and New York; separate long/short and breakout/retest/trend setups.
- Prior Sydney sample: 24 trades, 50% wins, +6.93 R, PF 1.48. It is too small to trust without more data and forward confirmation.
- Verify venue alignment: Kraken/Coinbase spot is not the same instrument or fill quality as a BTCUSD CFD. Record provider, venue, quote age, bid/ask and source mismatch.

### XAUUSD
- Decompose sessions, especially London–New York overlap, long/short, news proximity and volatility regime.
- Prior overlap sample: 38 trades, 44.74% wins, +6.22 R, PF 1.25. This is a hypothesis only, not evidence of durable edge.
- Audit high-impact calendar proximity, DXY/yield context, spread/ATR, entry displacement and whether the stop/target model survives realistic two-sided slippage.

## Training-only experiment matrix

Use the first 70% of chronologically sorted candles for all feature/filter selection. The final 30% is frozen and untouched until a candidate and its parameters are committed.

Run baseline first, then one-at-a-time filters:
1. Session eligibility (market-specific; do not assume one universal session).
2. M15 + H1 EMA50/200 directional alignment.
3. ADX regime threshold.
4. RSI + MACD momentum confirmation.
5. VWAP/CVD alignment (only where source data supports it).
6. BOS/CHOCH plus unfilled order-block/FVG retest.
7. A1 HEART opening-range breakout with 1.5x relative-volume confirmation (do not fabricate missing FX tick volume).
8. Spread/ATR and entry-deviation caps.

Then test only a small number of predeclared combinations justified by the single-filter results. Report trade count, net expectancy, PF, max drawdown, win-rate interval, session breakdown and costs for every variant. Reject filters that only improve headline win rate by starving the sample or that have no plausible entry-quality explanation.

## Untouched holdout gate

- Freeze strategy version, parameters, market/session eligibility and cost model before the holdout run.
- Run the holdout once on the later 30% chronological segment.
- Include spread, entry and exit slippage, and commission. Clearly label assumptions versus observed execution data.
- Report all markets, including losing ones. No parameter changes after seeing holdout results; any new iteration requires a new later holdout period.
- Passing CI is not passing performance. A candidate is still research-only pending forward evidence and independent review.

## Forward paper ledger specification

Record every candidate and every paper-approved signal from provider-timestamped bid/ask quotes:
- Unique signal ID; market; side; strategy version/profile; setup family; signal and quote timestamps.
- Provider, venue, bid, ask, observed spread, quote age, spread/ATR and feed health.
- Indicative entry, stop, target, planned R:R, confirmation state and every approval/risk gate result.
- Subsequent path: TP/SL/time expiry, exit timestamp/price, MAE, MFE and realized gross/net R.
- Observed spread at entry and exit must be separate from estimated slippage and commission. Never claim estimated slippage is an observed fill.
- Persist append-only across restarts, deduplicate by signal ID, retain unresolved trades, and record missing data as unavailable rather than inventing values.
- Daily/weekly rollups: market/session/profile, trade count, win rate, expectancy, PF, drawdown, costs, feed uptime, quote rejections and missing-data gaps.

## Promotion policy

Remain PAPER / RESEARCH until there is an adequate forward sample across relevant regimes, positive net expectancy after costs, PF above 1, controlled drawdown, credible observed spread/slippage measurements and independent review. No automatic promotion and no broker integration.
