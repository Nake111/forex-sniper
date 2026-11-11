# 150 ms live-tick safety gate

Forex Sniper has a fail-closed live-tick gate. A market can produce a non-HOLD signal only when its latest per-market tick snapshot is valid and its **local receive age is no more than 150 ms**. The gate is checked once before analysis and again immediately before the final signal, because agent and news analysis can take longer than the freshness budget.

## Feed adapters currently included

- **BTC/USD reference:** `src/live-feed.js` now keeps the existing Binance closed-M1 candle stream and also subscribes to Binance `btcusdt@trade`. Each trade atomically updates `data/live-ticks/BTCUSD.json`. This is Binance BTCUSDT spot as a BTC/USD proxy, not a broker BTCUSD CFD quote.
- **EUR/USD and XAU/USD references:** `src/gold-live-feed.js` subscribes to Twelve Data for `EUR/USD,XAU/USD` by default and writes `data/live-ticks/EURUSD.json` and `data/live-ticks/XAUUSD.json`. These are third-party reference quotes, not Vantage bid/ask execution prices. A valid `TWELVE_DATA_API_KEY` is required.
- Run both feed processes with `npm run live:feeds`. This command is intended for a continuously running machine. On a free scheduled GitHub runner it will stop when the job ends.

## Tick snapshot contract

Each file must contain:

```json
{
  "symbol": "EURUSD",
  "price": 1.085,
  "timestamp": 1800000000000,
  "receivedAt": 1800000000000,
  "source": "provider and instrument"
}
```

- `timestamp` is the provider event timestamp.
- `receivedAt` is the local machine's receipt time, recorded immediately when the message arrives.
- `price` must be a positive finite number.
- The symbol must match the requested market exactly.

The 150 ms gate measures `Date.now() - receivedAt`. This measures how recently the app received a tick; it does **not** prove the provider's upstream delivery latency was below 150 ms. Provider event timestamps and local clocks must be synchronized and benchmarked separately before making an upstream-latency claim.

## Free-hosting limitation

The feed adapters can run without a VPS purchase, but they require an always-on process. GitHub Actions is scheduled and is not a continuous WebSocket host. A free host may sleep, restart or limit long-running connections; when that happens the snapshots become stale and the engine must return HOLD. Do not treat this as a guaranteed 150 ms service.

The existing Binance stream is spot data and the Twelve Data stream is reference data. Broker-specific spread, slippage and execution quotes are not connected. No orders are sent.
