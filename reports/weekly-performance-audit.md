# Forex Sniper — Weekly Performance Audit

- Generated: 2026-11-23T18:06:32.392Z
- Window: 2026-11-16T18:06:32.392Z to 2026-11-23T18:06:32.392Z
- Mode: PAPER / RESEARCH ONLY

## Independent agent accuracy

| Agent | BUY predictions | BUY accuracy | BUY false signals | SELL predictions | SELL accuracy | SELL false signals |
|---|---:|---:|---:|---:|---:|---:|
| FxTT market scanner | 23 | 17.39 | 19 | 29 | 68.97 | 9 |
| Gann/Hurst trend | 43 | 41.86 | 25 | 56 | 60.71 | 22 |
| Higher-timeframe confluence analyst | 0 | n/a | 0 | 54 | 72.22 | 15 |
| ICT/SMC structure | 21 | 23.81 | 16 | 15 | 53.33 | 7 |
| Liquidity sweep and reclaim analyst | 3 | 33.33 | 2 | 1 | 100 | 0 |
| M5 candle-quality analyst | 55 | 27.27 | 40 | 51 | 45.1 | 28 |
| Macro and news analyst | 0 | n/a | 0 | 0 | n/a | 0 |
| Momentum analyst | 68 | 29.41 | 48 | 62 | 58.06 | 26 |
| Momentum exhaustion analyst | 25 | 20 | 20 | 25 | 56 | 11 |
| Quantitative agent 1 — weighted regression | 0 | n/a | 0 | 0 | n/a | 0 |
| Quantitative agent 2 — autoregression | 8 | 25 | 6 | 17 | 88.24 | 2 |
| Quantitative agent 3 — Kalman filter | 40 | 30 | 28 | 41 | 60.98 | 16 |
| Quantitative agent 4 — EWMA volatility | 39 | 20.51 | 31 | 37 | 64.86 | 13 |
| Quantitative agent 5 — cycle model | 15 | 40 | 9 | 20 | 65 | 7 |
| Quantitative agent 6 — analog search | 33 | 21.21 | 26 | 35 | 60 | 14 |
| SMC and liquidity analyst | 8 | 25 | 6 | 1 | 100 | 0 |
| Systematic breakout | 9 | 22.22 | 7 | 6 | 66.67 | 2 |
| Technical analyst | 8 | 0 | 8 | 72 | 66.67 | 24 |
| Trading-session breakout analyst | 2 | 0 | 2 | 6 | 66.67 | 2 |
| Volatility and regime analyst | 7 | 0 | 7 | 30 | 70 | 9 |
| Volume and auction analyst | 0 | n/a | 0 | 0 | n/a | 0 |
| hpFX multi-timeframe | 13 | 15.38 | 11 | 36 | 61.11 | 14 |

## Market regimes

- **ABNORMAL:** 154 resolved forecasts
- **BEAR_TREND:** 1056 resolved forecasts
- **BULL_TREND:** 726 resolved forecasts
- **HIGH_VOLATILITY:** 242 resolved forecasts
- **RANGE:** 1452 resolved forecasts

## Execution evidence

- Quote observations: 180
- Valid quotes: 141
- Average quote age: 1852.4 ms
- Maximum quote age: 13856 ms
- Average observed spread: 0.2951 bps
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
