# Forex Sniper — Profitability Evidence Gate

**Operating mode: PAPER / RESEARCH ONLY.** This document defines how the project selects its strongest research candidate. It does not claim or guarantee profitability and does not authorize broker connectivity or live orders.

## Objective

Maximize risk-adjusted, out-of-sample net expectancy after realistic execution costs. Signal frequency, indicator count, agent consensus, and win rate alone are not objectives.

A strategy is not considered profitable merely because it has a high historical win rate or a positive in-sample backtest.

## Non-negotiable data and validation rules

1. Sort observations chronologically and remove duplicates before any split.
2. Use only the first 70% of each market's chronological history for research, diagnostics, parameter selection, and walk-forward development.
3. Freeze the candidate strategy, parameters, market/session filters, execution assumptions, and code revision before accessing the final 30%.
4. Preserve the final 30% as an untouched holdout. Evaluate it once for the frozen candidate. Do not tune against it, select among variants using it, or repeatedly rerun it as a development score.
5. If the holdout is accidentally inspected during development, mark it contaminated and obtain a new genuinely unseen period before claiming independent validation.
6. Never combine BTCUSD, EURUSD, and XAUUSD results into one headline metric that hides a failing market.

## Required performance report

Report each market and strategy independently, with separate BUY and SELL rows. Where sample size permits, also break down by M5/M15/H1/H4 context, trading session, and market regime.

For every group report:
- Number of forecasts, approved signals, resolved trades, pending trades, and rejected candidates.
- BUY/SELL directional accuracy and false-signal rate.
- Win rate with sample size and uncertainty interval.
- Average win R, average loss R, net expectancy R per resolved trade, profit factor, cumulative net R, and maximum drawdown.
- Results before and after spread, commission, and slippage assumptions.
- Quote age, observed bid/ask spread, spread/ATR, entry displacement, and data-source coverage.
- Strategy/code/configuration version and exact evaluation date range.

Do not rank a group with fewer than 30 resolved trades as established evidence. Treat 30–99 as preliminary; seek at least 100 resolved forward paper trades for an initial decision and preferably 200+ per strategy/side where feasible. Sample size does not replace independent validation.

## Execution realism

- Use provider-timestamped bid and ask where available; never substitute a candle close for an executable quote without labelling the approximation.
- BUY entry assumptions must use the ask side and SELL entry assumptions the bid side; exits must use the corresponding executable side.
- Reject stale, crossed, missing, or invalid quotes. Record quote age and source.
- Deduct observed spread, configured commission, and conservative slippage. If a cost is unknown, label it unknown and do not call the result fully net.
- Model gaps and same-candle stop/target ambiguity conservatively. State the tie-break rule.
- Do not treat paper reference prices as actual broker fills.

## Strategy promotion and demotion

A candidate can be promoted for continued paper testing only when:
1. It has a positive net expectancy after the documented cost model on training-only walk-forward evaluation.
2. Profit factor is above 1 after costs, drawdown is within a predeclared risk limit, and results are not driven by one exceptional trade or one narrow market condition.
3. BUY and SELL performance are reported independently; a weak side is disabled or separately constrained rather than hidden by aggregate results.
4. The untouched holdout supports the frozen candidate without parameter changes.
5. Forward paper results remain consistent with the backtest under fresh data and realistic quote checks.

A stricter internal target such as profit factor >= 1.2 may be used as a development hurdle, but it is a chosen threshold, not proof of future returns. Record thresholds before testing; never change them after seeing holdout results.

If evidence is negative, inconclusive, stale, too small, or execution costs are unavailable, keep the strategy in research or disable it. The system must return **NO APPROVED TRADE** when no candidate passes every existing data, risk, quote, and approval gate. Never relax a gate just to produce a BUY/SELL.

## Agent accountability

Every agent forecast must be stored with agent name/version, market, predicted side, forecast timestamp, reference price, regime, horizon, and evidence. Resolve it against the specified future horizon without look-ahead. Report BUY and SELL accuracy and false-signal rate independently. Agents remain diagnostics with zero signal weight unless their incremental value is demonstrated on training-only walk-forward data and then independently validated.

## Best-system selection for signal requests

For each "run proper working signal" request:
1. Inspect the latest successful analysis cycle and verify its data timestamps, quote source, quote age, workflow status, and watchdog state.
2. Use only strategies that have passed the current evidence and risk gates; compare them by net expectancy, profit factor, drawdown, and sample quality—not raw score or number of agreeing agents.
3. Analyse each requested market independently. Do not assume the most recently successful run is fresh enough for the current request.
4. Return BUY or SELL only for a fully approved paper plan with valid entry, stop, target, risk/reward, quote evidence, and timestamp. Otherwise return **NO APPROVED TRADE** and state the blockers.
5. Never invent live prices, fills, backtest results, workflow success, or a signal when data cannot be verified.

## Change control

Every strategy change must include its hypothesis, exact files/configuration changed, training-only evidence, test coverage, and a rollback path. Preserve the pre-change results. Do not merge broad divergent branches merely to import a strategy. Do not claim a change is profitable until the required independent evidence exists.
