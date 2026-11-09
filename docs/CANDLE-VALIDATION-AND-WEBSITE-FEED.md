# Forex Sniper: candle validation and website feed

## Pipeline
1. GitHub Actions refreshes EUR/USD, BTC/USD and XAU/USD candle files on a five-minute schedule target.
2. The Forex Sniper engine (`npm start`) analyses those local files and applies its own stale-data gate.
3. `npm run publish:data` validates the files and writes `dashboard/data/latest.json`.
4. The dashboard polls that public JSON snapshot every 30 seconds. This is a scheduled snapshot feed, not a tick-by-tick or broker-executable stream.

## Data sources and symbol caveats
- EUR/USD: Dukascopy, or Twelve Data when `TWELVE_DATA_API_KEY` is configured.
- BTC/USD: Kraken XBT/USD spot when `BTC_DATA_PREFIX=kraken-btcusd`; this is not a Vantage BTCUSD CFD quote.
- XAU/USD: Dukascopy, or Twelve Data when configured.
- Provider timestamps, spread and CFD pricing may differ from the broker. Confirm bid/ask on the broker before any trade.

## Validation gates
Each market is checked on M5, M15, H1 and H4:
- OHLC values must be numeric and internally consistent.
- Only fully closed candles are published.
- Candles are timestamp-sorted and duplicate timestamps removed.
- At least 60 valid closed candles are required per timeframe.
- Freshness warning thresholds: M5 30 minutes, M15 60 minutes, H1 3 hours, H4 12 hours.
- Missing intervals in the recent 120-candle window are flagged.

A `WARN` appears on the website. It is not a validated entry. The engine's own stale-data safety gate remains authoritative.

## Proper strategy validation
Each scheduled run executes syntax checks and tests, downloads candles, runs `npm start`, then publishes the website snapshot.
For strategy performance use chronological holdout backtests:
- `npm run backtest:holdout`
- `npm run backtest:holdout:advanced`
- `npm run backtest:holdout:institutional`

Compare net expectancy after realistic spread/slippage, profit factor, maximum drawdown, trade count and market/session breakdown. Do not select a profile on win rate alone. Data-quality PASS does not prove profitability.

## Manual checks
```bash
npm ci
npm run check
npm test
DATA_DAYS_BACK=30 BTC_DATA_PREFIX=kraken-btcusd npm run download
BTC_DATA_PREFIX=kraken-btcusd npm start
BTC_DATA_PREFIX=kraken-btcusd npm run publish:data
```

## Website endpoint
`https://raw.githubusercontent.com/Nake111/forex-sniper/main/dashboard/data/latest.json`

The scheduled workflow commits this file to `main`. The website polls every 30 seconds. GitHub Actions may start late; five minutes is a target, not a latency guarantee.

## Safety and limitations
- Live trading remains disabled; no orders are sent.
- GitHub Actions is batch scheduling, not a continuous streaming service.
- The previous snapshot can remain visible during workflow execution or a provider outage; the dashboard displays generation time and candle age.
- Stale, missing or invalid candles are not suitable for a fresh entry.
- Historical results do not guarantee future profitability.