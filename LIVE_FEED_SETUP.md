# 150 ms live-tick safety gate

Forex Sniper now has a fail-closed live-tick gate. Before a market can produce a non-HOLD signal, it must have a valid per-market tick snapshot whose **local receive age is no more than 150 ms** at analysis time.

## Required runtime files

A continuously running feed adapter must atomically write one file per market:

- `data/live-ticks/EURUSD.json`
- `data/live-ticks/BTCUSD.json`
- `data/live-ticks/XAUUSD.json`

Each file must contain this shape (all timestamps may be Unix milliseconds or ISO-8601 strings):

```json
{
  "symbol": "EURUSD",
  "price": 1.085,
  "timestamp": 1800000000000,
  "receivedAt": 1800000000000,
  "source": "provider and instrument"
}
```

- `timestamp` is the provider's event timestamp.
- `receivedAt` is the local machine's receipt time, recorded immediately when the tick arrives.
- `price` must be a positive finite number.
- The symbol must match the requested market exactly.

The gate measures `Date.now() - receivedAt`. It does **not** prove that the provider's upstream market data was delivered within 150 ms; provider-to-server latency must be measured separately using source timestamps where their precision and clock synchronization permit it.

## Current deployment limitation

The existing Binance BTC feed listens to completed one-minute klines, not every trade tick. The Twelve Data feed is a reference quote feed and currently does not write the three required per-market snapshots. GitHub Actions runs on a schedule and is not a continuously running WebSocket host. Therefore, until compatible feed adapters and an always-on runtime are connected, the expected result is **HOLD: live tick missing**. This is intentional and prevents old candle files from being presented as 150 ms live data.

A free scheduled runner can continue historical candle refresh and research, but it cannot honestly guarantee continuous 150 ms tick freshness. No paid hosting or provider subscription is assumed by this change.
