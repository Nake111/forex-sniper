# XAUUSD Gold module

This module adds XAUUSD to Forex Sniper's existing multi-timeframe signal pipeline.

## Included
- Dukascopy historical candle download for XAUUSD: M5, M15, H1 and H4.
- Indicator engine: EMA20/50/200, RSI14, MACD, ATR14, ADX14, squeeze momentum, rolling VWAP, volume-profile POC/value area, Ichimoku Cloud, MFI, CCI, Stochastic RSI, Parabolic SAR, Donchian Channels, OBV, Williams %R, Keltner Channels, Aroon and ROC, plus market structure, liquidity sweeps, order blocks and fair-value gaps.
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


## Additional technical indicators
The latest indicator upgrade adds four independent measures:
- Stochastic RSI (14, 14, 3, 3): momentum timing; extreme readings alone are not reversal signals.
- Parabolic SAR (0.02 step, 0.20 maximum): trend/trailing-stop context; prone to whipsaws in ranges.
- Donchian Channels (20): prior-20-bar breakout check, deliberately excluding the current bar from the channel boundary.
- OBV (5-bar slope): accumulation/distribution proxy using the feed's reported candle volume. Spot FX/CFD volume is generally tick volume, not consolidated exchange volume.

These are added to timeframe vote counts and institutional scoring. They are not standalone trade instructions. Their incremental value must be measured by ablation tests and out-of-sample results.

## Optional streaming quote reference
A long-running Twelve Data WebSocket process can save XAU/USD and DXY reference ticks:
`TWELVE_DATA_API_KEY=... npm run live:gold`
Configure `TWELVE_DATA_API_KEY` as a secret on the hosting machine. Never commit the real key. `GOLD_LIVE_SYMBOLS` can be changed to symbols supported by the user's Twelve Data subscription. The feed writes `data/gold-live-ticks.jsonl` and `data/gold-live-quotes.json`; the signal report prints quote age and warns when older than 120 seconds.

This is a third-party reference feed, not a Vantage quote and not an order connection. It does not replace the historical candle feed or automatically alter entries. GitHub Actions is not a persistent WebSocket host; run this worker on an always-on VPS/container with persistent storage if continuous ticks are required. The API key and a suitable hosting environment are still required.

## Macro and calendar sources
- Treasury daily real-yield curve: official US Treasury data.
- CFTC Disaggregated COT: weekly managed-money positioning; slow context only.
- BLS release calendar: official BLS iCalendar feed for major labor and inflation releases.
- Federal Reserve FOMC calendar: official meeting schedule; scheduled policy statement assumed at 2:00 p.m. America/New_York on the second meeting day.
- Gold headlines: Google News RSS with GDELT fallback, filtered to the latest 24 hours.

The Gold entry gate requires both macro/news risk to be NORMAL. HIGH or UNKNOWN means HOLD. This is deliberately conservative: an unavailable calendar is not silently treated as a safe trading window. The COT and Treasury series can be unavailable without turning their absence into directional information.


## Gold-specific signal profile
The optional `gold` profile is deliberately stricter than baseline: 4 M5 votes, 4 M15 votes, 3 H1 votes, RSI threshold 54/46, ADX at least 20 on M5/M15, VWAP plus volume-pressure confirmation, and a recent OB/FVG retest. It is an unvalidated candidate profile until the scheduled full-history and chronological holdout tests report sufficient trades, positive expectancy after costs, and controlled drawdown. Do not assume it is superior merely because it is stricter.


The Gold profile also uses macro alignment when available: rising 10-year real yields and a rising DXY are treated as gold headwinds; falling values are treated as tailwinds. If the two sources disagree, the bias is neutral. The DXY component requires the optional streaming feed. Macro alignment is a soft veto only when it clearly opposes a candidate; unavailable data is not treated as bullish or bearish.

## Four additional indicators (new)
- Williams %R (14): range-position momentum, with -20/-80 overbought/oversold context.
- Keltner Channels (EMA 20, ATR 20 x 2): volatility-adjusted channel; only closes outside the channel count as breakout votes.
- Aroon (25): time since recent highs/lows; oscillator thresholds of +20/-20 determine directional bias.
- Rate of Change (12): percentage change versus 12 bars earlier; positive/negative values are directional momentum context.

The four additions are included in timeframe vote counts, signal score diagnostics and automated tests. Vote thresholds were raised to compensate for the larger indicator set; they still require full holdout validation and realistic transaction costs. Indicator agreement is not independent evidence when measures share price inputs.
