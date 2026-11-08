# XAUUSD Gold module

This module adds XAUUSD to Forex Sniper's existing multi-timeframe signal pipeline.

## Included
- Dukascopy historical candle download for XAUUSD: M5, M15, H1 and H4.
- Existing indicator engine: EMA20/50/200, RSI14, MACD, ATR14, ADX14, squeeze momentum, rolling VWAP, volume-profile POC/value area, candle-volume pressure proxy, market structure, liquidity sweeps, order blocks and fair-value gaps.
- Gold-specific Google News RSS feed with GDELT fallback. It filters recent headlines around gold, USD, Federal Reserve/FOMC, Treasury/real yields, DXY, CPI/PCE, NFP, central banks and geopolitical risk.
- Existing macro event-risk gate and paper-only trade-plan generation.
- XAUUSD historical backtest support via MARKET=XAUUSD.

## Research-informed context
The feature selection is informed by:
- World Gold Council, *Gold Demand Trends: Q3 2026* (3 Nov 2026): https://www.gold.org/goldhub/research/gold-demand-trends/gold-demand-trends-q3-2026/outlook
- World Gold Council, *Gold Market Commentary: Where floor art thou?* (Oct 2026): https://www.gold.org/goldhub/research/gold-market-commentary-october-2026
- CFTC Commitments of Traders data: https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm
- Trading Economics economic calendar: https://tradingeconomics.com/calendar.aspx

Gold drivers tracked in research include US dollar strength, nominal/real yields, inflation and rate expectations, geopolitical risk, ETF/central-bank demand, momentum and speculative futures positioning. Weekly COT is slow context, not an intraday entry trigger. The current code does not yet ingest official CFTC COT or a live Treasury real-yield/DXY feed; headlines are context only and must not be treated as verified event data.

## Signal discipline
- BUY/SELL requires the existing multi-timeframe conditions and H1 confirmation.
- High-impact recent macro headlines block new entries.
- Entry/SL/TP are paper-analysis levels only; no broker orders are sent.
- Do not claim a target win rate. Run walk-forward/holdout backtests with realistic broker spread, commission and slippage before use.
- Dukascopy candles are historical feed data, not a guaranteed match to the user's Vantage CFD quote. Validate against the Vantage XAUUSD symbol and contract specifications.

## Commands
`npm run download` downloads all configured markets and timeframes.
`MARKET=XAUUSD node src/backtest.js` runs the gold backtest.
`BACKTEST_START_RATIO=0.7 MARKET=XAUUSD node src/backtest.js` tests the final 30% holdout segment.
`npm test && npm run check` runs the repository test and syntax checks.
