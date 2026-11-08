# Forex Sniper — EUR/USD + BTC/USD

A Node.js market-analysis and paper-signal project for **EUR/USD** and **BTC/USD**. It analyses closed M5, M15 and H1 candles and prints a separate signal report for each market.

## What it does

- Downloads historical M5, M15 and H1 candles from Dukascopy using `dukascopy-node`.
- Calculates EMA 20/50, RSI 14, MACD, ATR, volume profile (POC/VAH/VAL), market structure and squeeze momentum.
- Tracks London, New York, Tokyo and Sydney sessions, active-session high/low ranges, London/New York overlap, and breakouts above/below the range formed by earlier candles in the active session. Session data is informational and does not force trades; BTC/USD remains tradable around the clock.
- Session hours use a fixed UTC offset by default. Set `SESSION_UTC_OFFSET` to an integer UTC offset if you want to shift the session clock; daylight-saving changes are not automatic.
- For BTC/USD, reads Deribit public options data and reports nearest-expiry call/put open-interest walls, options-volume concentration, OI-weighted IV concentration, max pain and an unsigned gross-gamma proxy.
- Keeps options positioning as supplemental context; it does not independently trigger BUY/SELL.
- Evaluates each market independently and prints `BUY`, `SELL` or `NO TRADE`.
- Produces an ATR-based entry, stop-loss and take-profit only when the M5/M15 setup and H1 confirmation align.
- Includes unit tests for signal direction, confirmation logic and options-wall calculations.

**Options data limitations:** Deribit public open interest is delayed by 8 hours. Open interest does not reveal dealer long/short positioning, so the gamma figure is an unsigned approximation, not signed dealer GEX. BTC options levels must not be treated as guaranteed support/resistance. The current free data setup does not provide a consolidated listed-options chain for EUR/USD.

**Safety:** this project is analysis-only. It does not connect to Vantage or place live orders. A BUY/SELL output is not a guarantee of profitability. Validate performance with realistic spreads, commissions, slippage and out-of-sample testing before risking money.

## Session context and source licensing\n\nThe session module is an independent implementation of common market-session timing and range calculations. It does not include LuxAlgo source code. The LuxAlgo Pine Script supplied as a reference by the project owner is marked CC BY-NC-SA 4.0; do not copy or redistribute that source, or use a derivative of it commercially, unless the license terms permit it.\n\n## Requirements

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

The output contains separate EUR/USD and BTC/USD reports. BTC options context is fetched from Deribit public endpoints; if that service is unavailable, spot analysis continues without it. If one market is missing valid candle data, the other market is still analysed; the process exits with an error status so the missing dataset is visible.

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
