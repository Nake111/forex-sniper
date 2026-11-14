# Forex Alpha Pip PRO — research adaptation

Upstream: https://github.com/lightningfast66/forex-alpha-pip-pro-mt4-indicator

## Source availability and scope

The upstream repository currently contains only a README. It does not contain MQL4 source, an `.ex4` binary, a release asset, dependency manifest, or an explicit license. Forex Sniper does not install a binary or claim to reproduce the proprietary/undisclosed MT4 indicator. The upstream README's claimed non-repainting behavior and performance are not independently verified.

This implementation is an independent research adaptation of the README's described concepts:
- ATR expansion relative to a historical ATR baseline,
- directional trend structure using EMA20/EMA50,
- multi-period price acceleration using 5-, 12-, and 24-candle rate of change,
- requiring at least two of three momentum periods to align with the structural trend.

## Safety and use

The output is attached to each timeframe analysis and the M5 research candidate snapshot. It is marked research-only, has zero score weight, cannot create or promote BUY/SELL, cannot approve a trade, and cannot bypass fresh quote, spread, closed-entry, stop/target, minimum risk/reward or independent approval gates.

The analysis uses the latest candle supplied to the pipeline. A historical candle series alone does not prove that a live feed candle is closed or non-repainting; existing quote-age and entry-verification gates remain authoritative.

## Validation

Unit tests cover bullish/bearish alignment, missing volatility expansion, conflicting momentum and unavailable data. These tests establish code behavior only, not win rate or profitability.

Do not tune against the preserved final 30% holdout. Evaluate any future scoring proposal only on the chronological training segment, freeze settings, then run the holdout once.
