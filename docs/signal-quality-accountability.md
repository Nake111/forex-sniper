# Signal quality, accountability and validation

- Each research agent forecast is stored independently with its own signal, evidence, reason, timestamp, ATR and market regime.
- Forecast outcomes are resolved after 12 closed M5 bars. The actual direction is BUY/SELL only when the move exceeds 0.25 of the reference ATR; otherwise it is FLAT. A directional prediction against FLAT or the opposite direction counts as a false signal.
- BUY and SELL precision/false-signal rates are reported separately. NO_SIGNAL forecasts are retained for accountability but are not included in directional precision.
- Regimes: BULL_TREND, BEAR_TREND, RANGE, HIGH_VOLATILITY, ABNORMAL, UNKNOWN. ABNORMAL is a data/price-shock warning, not a trade direction.
- Quote evidence must retain provider bid/ask, provider timestamp, receive timestamp, spread, quote age and source. Slippage is observed only when an actual fill exists; paper estimates must never be labelled observed.
- Validation uses chronological 70/30 splits. Candidate tuning is restricted to the first 70%. The final 30% must be frozen before candidate selection and evaluated once after settings are committed. Do not use holdout results to tune settings.
- This project remains paper/research only. No broker orders are sent.
