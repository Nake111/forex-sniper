# Forex Sniper — EUR/USD + BTC/USD

A Node.js market-analysis and paper-signal project for **EUR/USD** and **BTC/USD**. It analyses closed M5, M15 and H1 candles and prints a separate signal report for each market.

## What it does

- Downloads historical M5, M15 and H1 candles from Dukascopy using `dukascopy-node`.
- Calculates EMA 20/50, RSI 14, MACD, ATR, volume profile (POC/VAH/VAL), market structure and squeeze momentum.
- Evaluates each market independently and prints `BUY`, `SELL` or `NO TRADE`.
- Produces an ATR-based entry, stop-loss and take-profit only when the M5/M15 setup and H1 confirmation align.
- Includes unit tests for signal direction and confirmation logic.

**Safety:** this project is analysis-only. It does not connect to Vantage or place live orders. A BUY/SELL output is not a guarantee of profitability. Validate performance with realistic spreads, commissions, slippage and out-of-sample testing before risking money.

## Requirements

- Node.js 20+
- npm

## Setup

```bash
npm install
npm run check
npm test
```

## Download market data

Downloads 180 days by default for both instruments and all three timeframes:

```bash
npm run download
```

To change the download period (30–730 days):

```bash
DATA_DAYS_BACK=90 npm run download
```

The six datasets are saved under `data/`:

- `eurusd-m5.json`, `eurusd-m15.json`, `eurusd-h1.json`
- `btcusd-m5.json`, `btcusd-m15.json`, `btcusd-h1.json`

## Run both signal engines

```bash
npm start
```

The output contains separate EUR/USD and BTC/USD reports. If one market is missing valid data, the other market is still analysed; the process exits with an error status so the missing dataset is visible.

## GitHub Actions

Open **Actions → Forex Sniper Analysis → Run workflow** to install dependencies, run syntax checks and tests, download fresh candles, and create a report artifact.

## Backtest

Run the BTC/USD historical simulation (default):

```bash
npm run backtest
```

Run EUR/USD:

```bash
MARKET=EURUSD npm run backtest
```

The default round-trip cost assumptions are 10 basis points for BTC/USD and 0.5 basis points for EUR/USD. Override with `BACKTEST_COST_BPS` to model your own estimated spread and fees. These are assumptions, not a quote from your broker.

## Tests

```bash
npm test
npm run check
```

A HOLD / NO TRADE result is intentional when the timeframes disagree or confirmation is missing. Do not loosen filters just to force more trades; judge changes by out-of-sample backtests and risk-adjusted results.
