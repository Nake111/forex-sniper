# Forex Sniper — Weekly Performance Audit

- Generated: 2026-11-16T15:44:33.775Z
- Window: 2026-11-09T15:44:33.775Z to 2026-11-16T15:44:33.775Z
- Mode: PAPER / RESEARCH ONLY

## Independent agent accuracy

| Agent | BUY predictions | BUY accuracy | BUY false signals | SELL predictions | SELL accuracy | SELL false signals |
|---|---:|---:|---:|---:|---:|---:|
| FxTT market scanner | 6 | 16.67 | 5 | 6 | 50 | 3 |
| Gann/Hurst trend | 7 | 0 | 7 | 17 | 35.29 | 11 |
| Higher-timeframe confluence analyst | 0 | n/a | 0 | 14 | 57.14 | 6 |
| ICT/SMC structure | 5 | 20 | 4 | 3 | 100 | 0 |
| Liquidity sweep and reclaim analyst | 0 | n/a | 0 | 0 | n/a | 0 |
| M5 candle-quality analyst | 14 | 7.14 | 13 | 13 | 53.85 | 6 |
| Macro and news analyst | 0 | n/a | 0 | 0 | n/a | 0 |
| Momentum analyst | 21 | 14.29 | 18 | 13 | 53.85 | 6 |
| Momentum exhaustion analyst | 5 | 60 | 2 | 7 | 57.14 | 3 |
| Quantitative agent 1 — weighted regression | 0 | n/a | 0 | 0 | n/a | 0 |
| Quantitative agent 2 — autoregression | 4 | 0 | 4 | 1 | 0 | 1 |
| Quantitative agent 3 — Kalman filter | 10 | 30 | 7 | 7 | 71.43 | 2 |
| Quantitative agent 4 — EWMA volatility | 11 | 36.36 | 7 | 4 | 75 | 1 |
| Quantitative agent 5 — cycle model | 6 | 16.67 | 5 | 9 | 33.33 | 6 |
| Quantitative agent 6 — analog search | 12 | 16.67 | 10 | 18 | 38.89 | 11 |
| SMC and liquidity analyst | 3 | 0 | 3 | 5 | 80 | 1 |
| Systematic breakout | 1 | 0 | 1 | 1 | 100 | 0 |
| Technical analyst | 1 | 0 | 1 | 19 | 52.63 | 9 |
| Trading-session breakout analyst | 2 | 0 | 2 | 1 | 100 | 0 |
| Volatility and regime analyst | 1 | 0 | 1 | 7 | 57.14 | 3 |
| Volume and auction analyst | 0 | n/a | 0 | 2 | 100 | 0 |
| hpFX multi-timeframe | 7 | 0 | 7 | 8 | 62.5 | 3 |

## Market regimes

- **ABNORMAL:** 88 resolved forecasts
- **BEAR_TREND:** 279 resolved forecasts
- **BULL_TREND:** 176 resolved forecasts
- **HIGH_VOLATILITY:** 22 resolved forecasts
- **RANGE:** 551 resolved forecasts

## Execution evidence

- Quote observations: 230
- Valid quotes: 173
- Average quote age: 1824.7 ms
- Maximum quote age: 12649 ms
- Average observed spread: 0.2739 bps
- Actual fills recorded: 0
- Slippage is not inferred from estimates; no actual fill means no observed slippage.

## Validation safeguards

- Holdout accessed: **No**
- Holdout used for tuning: **No**
- First 70% remains the only tuning segment.
- Final 30% remains reserved for one untouched evaluation after settings are frozen.
- 3/5 consensus threshold unchanged.
- No broker orders placed.

## Sample-size warning

Accuracy percentages are descriptive, not proof of profitability. Do not rank agents or change strategy settings on small samples; require adequate resolved samples and training-only validation.
