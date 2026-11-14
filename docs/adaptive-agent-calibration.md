# Adaptive agent calibration

## Purpose

The five independent research adapters and the 17 deterministic specialist agents receive conservative, market-specific and direction-specific reliability multipliers. The five-agent quorum still requires at least 3 of 5 directional votes and at least 60% of directional reliability-weighted support. This changes only the relative contribution of specialist votes; it does not relax any candidate, confirmation, quote, stale-data, macro, entry, spread, stop-loss, or minimum 1:2 risk/reward gate.

## Training boundary is mandatory

Set the GitHub Actions repository variable `AGENT_TRAINING_CUTOFF` to the ISO-8601 timestamp that ends the already-frozen training partition (Repository Settings → Secrets and variables → Actions → Variables). The signal workflows pass this variable to the analysis process. The calibration code accepts only resolved `AGENT_FORECAST_OUTCOME` records for the requested market whose `forecastAt` is at or before that timestamp. Records after the cutoff are not used to calculate, rank, or tune weights.

If the cutoff is absent or invalid, calibration is disabled and the existing baseline weights remain in force. Do not set the cutoff by looking for the best holdout result. Freeze it from the chronological dataset definition before tuning.

## Calibration method

- Separate EURUSD, BTCUSD and XAUUSD.
- Separate BUY and SELL for every agent.
- Require at least 30 resolved training forecasts for an agent/side.
- Use a Beta(10,10) prior to shrink small samples toward 50% accuracy.
- Convert posterior accuracy to a bounded multiplier from 0.75 to 1.25.
- Keep baseline weight for insufficient samples.
- Do not auto-disable or promote a strategy based on a small sample.
- Forecast outcomes include FLAT as a non-correct directional result.

## Forecast accountability correction

Agent objects expose `direction`, while the prior journal adapter read only `signal`. The adapter now accepts either field so directional forecasts are actually recorded. Existing historical `NO_SIGNAL` rows are not retroactively rewritten.

## Operational status

This is a paper/research-only calibration layer. It is not evidence of profitability. The calibration report exposes the cutoff, sample sizes and applied multipliers. A candidate still requires independent approval and realistic execution checks. Validate changes on training data only, freeze the candidate, and evaluate the untouched final 30% once.
