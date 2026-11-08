# Online BTC market data

The signal engine can use Binance Spot BTCUSDT public market data without an API key.

## Data collected

- Closed 5-minute, 15-minute and 1-hour OHLCV candles
- Latest BTCUSDT price, best bid/ask and spread
- 24-hour change, high/low, volume and trade count
- Coinbase BTC-USD ticker as an independent spot-price cross-check when available
- UTC timestamps for every saved snapshot and latest closed candle

Files are stored in `data/online-*.json` and `data/online-market.json`.

## Automation and limitations

GitHub Actions schedules collection every five minutes. It is an automated polling service, not a continuously running WebSocket server: GitHub may delay scheduled jobs, so the collector cannot guarantee tick-by-tick or uninterrupted 24/7 updates. The script is incremental, backfills 14 days of M5, 30 days of M15 and 90 days of H1 data on first run, and retains rolling history.

For a true always-on live stream, run a persistent WebSocket collector on an always-on host. Binance's public market-data WebSocket endpoint is `wss://data-stream.binance.vision`; Binance documents a 24-hour connection lifetime, so a production collector must reconnect automatically.

## Important instrument distinction

This feed is Binance BTCUSDT spot, with Coinbase BTC-USD as a cross-check. It is not Vantage's BTCUSD CFD quote. CFD spreads, pricing, trading hours/contract rules and execution can differ. Compare the signal's reference price with the Vantage app before considering a trade. This integration is market-data-only and places no orders.

Official Binance documentation:
- https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md
- https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md
