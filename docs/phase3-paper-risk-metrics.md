# Phase 3 — Forward-Paper Trade Journal & Risk Metrics

Phase 3 extends the existing append-only paper journal report. It does not change signal generation, signal weights, approvals, entry/stop/target levels, or broker behavior.

## Reported metrics

- Expectancy: average available net estimated R per resolved trade.
- Total net estimated R and average gross R.
- Profit factor: sum of positive net estimated R divided by the absolute sum of negative net estimated R.
- Average winning R, average losing R, and payoff ratio.
- Maximum drawdown in cumulative net estimated R, ordered by outcome resolution time.
- Decisive win rate: wins divided by wins plus losses. Timeouts and ambiguous same-candle outcomes are excluded from this denominator and reported separately.
- R-data coverage and estimated-commission coverage.
- Existing breakdowns by strategy, market, side, session and profile.

## Interpretation and limitations

These are paper OHLC-path estimates, not broker fills, account-currency P&L, or verified live execution. Spread and slippage use the existing journal's observed signal-time spread plus configured estimated slippage. If commission is not configured, net R falls back to the existing excluding-commission value and the report shows commission coverage; it must not be interpreted as fully all-in cost.

Maximum drawdown is calculated from the cumulative sequence of resolved net estimated R observations. It is not an intratrade equity curve and does not include open positions, capital sizing, funding, swaps, or account deposits/withdrawals.

A strategy group remains unqualified below 30 resolved paper outcomes. Reaching 30 is a minimum sample guard, not proof of edge or permission to trade. Do not tune against the protected final 30% chronological holdout. Forward-paper metrics are separate from historical holdout evaluation.

## Safety

- PAPER_RESEARCH_ONLY; no broker integration or order placement.
- No change to signal approval gates or adaptive weights.
- No changes to historical holdout data or split.
- Ambiguous stop/target same-candle outcomes remain excluded from decisive win rate and R calculations.
