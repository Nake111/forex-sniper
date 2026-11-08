# BTCUSD combined Forex Sniper decision engine

## Purpose
Decision support only. No order execution. The current repository data source is Dukascopy historical rates, not a direct Vantage feed; compare every quote with the Vantage app before placing any manual order.

## Combined evidence
- Trend: H1 EMA50/EMA200 and M15 EMA20/EMA50.
- Momentum: RSI(14), MACD(12,26,9), TTM Squeeze momentum.
- Structure: BOS/CHoCH, liquidity sweeps and confirmations.
- Smart Money Concepts: swing structure, order blocks and fair-value gaps as context.
- Volume Profile: POC, VAH and VAL.
- Breakout: M15 20-bar Donchian channel.
- Quality: ADX(14) and relative candle volume.
- Trigger: M5 EMA20, RSI and MACD.

## Decision gates
Require H1 trend alignment, a recent M15 breakout or structure break, M5 trigger confirmation, at least 8 directional evidence points and a 3-point lead over the opposite direction. Otherwise return HOLD. These scores are evidence counts, not probabilities or win-rate estimates. Several indicators are correlated.

## Default trade plan
- Entry reference: latest fully closed M5 close. Actual broker fill may differ.
- Stop: 1.5 x M5 ATR(14).
- Target: 3 x M5 ATR(14), nominal 1:2 before spread, commission and slippage.
- Position size must be calculated separately from account equity and chosen risk. Never assume a lot size.
- No trade when data is missing or stale.

## Data limits
- M5 closed-candle age limit: 20 minutes.
- M15 closed-candle age limit: 45 minutes.
- H1 closed-candle age limit: 2 hours.
- Volume is provider-reported candle volume, not consolidated BTC exchange volume.
- The EUR/USD news parser is not used as BTC news intelligence.
- Backtests must include realistic broker costs and out-of-sample evaluation. No target win rate is promised.
