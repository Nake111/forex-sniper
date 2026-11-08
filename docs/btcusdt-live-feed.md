# BTC/USD market data

The scheduled signal workflow uses Kraken's public XBT/USD OHLC endpoint for current BTC spot reference candles. It requests M5, M15, H1 and H4 bars. Kraken's public OHLC endpoint returns at most 720 recent bars per timeframe, which is enough for the live multi-timeframe signal engine but is not a 180-day backtest dataset.

The main Forex Sniper workflow uses this Kraken feed for the live signal snapshot, then separately downloads Dukascopy BTCUSD historical candles for chronological backtesting. The backtest therefore uses a different venue/data source and should be treated as a research proxy, not an exact replication of Kraken or Vantage execution.

## Run a current BTC/USD snapshot

```bash
BTC_DATA_PREFIX=kraken-btcusd MARKET_FILTER=BTCUSD npm run download
BTC_DATA_PREFIX=kraken-btcusd MARKET_FILTER=BTCUSD npm start
```

Kraken is a public read-only spot reference feed. It does not connect to Vantage and does not place orders. Broker CFD prices, spreads, swaps and slippage can differ.

## Run historical BTCUSD backtests

```bash
BTC_DATA_PREFIX=btcusd DATA_DAYS_BACK=180 MARKET_FILTER=BTCUSD npm run download
BTC_DATA_PREFIX=btcusd MARKET=BTCUSD npm run backtest:holdout
```
