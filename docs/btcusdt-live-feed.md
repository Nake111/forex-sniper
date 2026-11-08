# BTCUSDT live market feed

The live feed is a read-only public Binance Spot WebSocket consumer. It does not connect to Vantage and does not place orders.

## Run

```bash
npm install
npm run live:btc
```

The service bootstraps up to 5,000 closed one-minute candles from Binance REST, then follows the public `btcusdt@kline_1m` stream. It reconnects after disconnects and writes closed candles atomically to:

- `data/btcusdt-m5.json`
- `data/btcusdt-m15.json`
- `data/btcusdt-h1.json`

Keep the process running on an always-on VPS or worker. GitHub Actions is not a persistent WebSocket host. Configure the host to restart the process on failure.

## Generate a report from the Binance feed

In a second process, with the feed running:

```bash
BTC_DATA_PREFIX=btcusdt npm start
```

The existing BTC analysis then reads the Binance-derived files instead of the default Dukascopy BTCUSD files. The Binance instrument is **BTCUSDT spot**, so USDT is used as a proxy for USD; it is not the Vantage BTCUSD CFD price. Expect small venue/basis differences. Do not mix the two data sources in one backtest.

## Operational notes

- The service only persists fully closed candles.
- It keeps up to 10,000 one-minute candles in memory and writes up to 2,000 bars per derived timeframe.
- Initial history is limited by the public REST endpoint and may be temporarily unavailable due to network or exchange limits.
- No API key or secret is required for this public market-data stream.
- Do not put exchange or broker credentials in source code or commit them to Git.
