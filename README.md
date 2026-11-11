# Forex Sniper — EUR/USD + BTC/USD + XAU/USD

A Node.js market-analysis and paper-signal project for EUR/USD, BTC/USD and XAU/USD. It analyses closed M5, M15, H1 and H4 candles and prints a separate report for each market.

## What it does

- Downloads historical candles from Dukascopy using dukascopy-node.
- Calculates EMA, RSI, MACD, ATR, volume profile (POC/VAH/VAL), market structure and squeeze momentum.
- Tracks London, New York, Tokyo and Sydney sessions and session ranges.
- Uses BTC options positioning as supplemental context only.
- Evaluates each market independently and produces an ATR-based entry, stop-loss and take-profit only when setup and confirmation align.

Safety: this project is analysis-only. It does not connect to Vantage or place live orders. A BUY/SELL output is not a guarantee of profitability. Validate performance with realistic spreads, commissions, slippage and out-of-sample testing before risking money.

## Economic calendar status

The Finance Calendar API integration and FINANCE_CALENDAR_API_KEY dependency have been removed because the provider rejected the configured key with HTTP 401.

Forex Factory remains a manual reference only: https://www.forexfactory.com/calendar. The project does not scrape, copy or redistribute its schedule. There is currently no automated structured economic-calendar provider.

Important safety behavior: with no verified automated calendar, event risk is UNKNOWN and the execution engine keeps new entries blocked (HOLD). Headline news is context only and does not replace a scheduled-event calendar. Do not interpret technical directional bias as permission to trade. A future provider must pass authentication, freshness, coverage, pagination and event-normalization checks before it can clear the calendar gate.

## Multi-agent decision layer

The local decision panel now contains 11 technical specialists plus six independent quantitative forecasting agents. The forecast agents use closed M5 candle history and estimate the next three candles with:
- Exponentially weighted least-squares trend projection and residual statistics.
- AR(1) conditional-return autoregression.
- A two-state local-linear-trend Kalman filter.
- EWMA volatility-adjusted momentum.
- Autocorrelation-based dominant-cycle and harmonic projection.
- Nearest-neighbour historical pattern outcomes.

Each forecaster reports BUY, SELL or HOLD, estimated probability of an upward move, expected movement in ATR units and its evidence. Forecasts are estimates, not certainty. A GOOD confirmation requires at least four of the six forecast agents to agree, in addition to the existing technical consensus, higher-timeframe alignment, volatility agreement and risk approval. The optional six-role Gemini review remains an independent veto-only check.

These agents cannot override stale candle checks, calendar risk, entry validation or portfolio risk controls. A technical HOLD cannot be promoted into a trade.

## Requirements

- Node.js 20+
- npm
- Optional GEMINI_API_KEY for the six-role cloud review
- Optional TWELVE_DATA_API_KEY for supplementary reference quotes

## Setup

```bash
npm install
npm run check
npm test
```

## Scheduled market data

The GitHub Actions workflow refreshes candles every five minutes, generates timestamped reports and publishes validated closed candles to the dashboard. GitHub Actions is polling, not continuous streaming; a run may be delayed. BTC/USD candles use Kraken spot reference data, not a broker CFD quote. These are reference feeds, not Vantage bid/ask execution prices. Respect the candle-age safety gate.

The latest output is available under Actions → Forex Sniper Live Candle Refresh → latest run → Artifacts. No live orders are placed.

## Tests

```bash
npm run check
npm test
```

A HOLD / NO TRADE result remains correct when confirmation or risk checks fail. No profile guarantees profitability.

## Quant Swarm dashboard

The browser dashboard is available in dashboard/. Its supplemental BTC quant view uses public market-data streams. Deterministic votes are indicators, not proof of profitability. Paper trading only; no live orders, wallet connection, deposits or withdrawals are supported.


## Investing.com secondary reference

The dashboard includes manual links to Investing.com for EUR/USD, Bitcoin and gold as an independent visual cross-check. This is not an automated data feed: Investing.com states it does not offer a public API. The project does not scrape its pages or feed displayed quotes into agent calculations. A reviewer should compare the same instrument, quote type and timestamp; any discrepancy is a data-quality warning only. Existing validated candle providers remain the engine's source of market data. Do not use this reference panel to override candle freshness, economic-calendar, consensus or risk gates.
