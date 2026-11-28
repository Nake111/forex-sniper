# Deploy the Binance BTC order-flow adapter

**Mode: PAPER / RESEARCH ONLY.** The adapter reads public Binance market data. It does not authenticate to a broker, submit orders, or create trade instructions.

## What it provides

- A rolling 60-second spot aggressive-buy / aggressive-sell volume and CVD from Binance Spot aggregate trades.
- A matching USD-M perpetual trade-flow window and CVD.
- Perpetual open-interest percentage change measured against a prior observation at least 60 seconds old.
- The latest perpetual funding rate.
- A provider timestamp derived from the latest spot trade, perpetual trade, and open-interest observation.

Binance aggregate-trade field `m` is interpreted using Binance's documented convention: `true` means the buyer was maker, so the seller was the aggressor. Volumes are in BTC. CVD is aggressive buy volume minus aggressive sell volume.

## Deploy as a separate Railway service

1. Deploy the same repository and `main` branch as a separate service, or deploy this feature branch for testing.
2. Set the service start command to `node src/binance-btc-order-flow.js`.
3. Expose the service on Railway's assigned `PORT`.
4. Wait at least 60 seconds for the open-interest baseline to warm up.
5. Confirm `/health` reports `READY`.
6. Set `BTC_ORDER_FLOW_FEED_URL` on the Forex Sniper signal service to the adapter's HTTPS `/order-flow` endpoint.
7. Trigger the normal paper-signal workflow and confirm the reported source, timestamp, CVD values, OI change and funding are present.

The adapter exposes:
- `GET /health`: readiness and last refresh error.
- `GET /order-flow`: the exact JSON contract consumed by `fetchBtcOrderFlowEvidence`; returns HTTP 503 when unavailable or stale.

## Fail-closed behavior and limitations

- The adapter refreshes every five seconds and refuses to serve snapshots older than 30 seconds.
- The first valid OI percentage change is unavailable until a full 60-second baseline has elapsed. During warm-up, `/order-flow` returns HTTP 503.
- Missing, malformed, stale, or failed Binance responses are not replaced with guessed values.
- Binance public API access may be restricted by region or network policy. A 4xx/5xx response keeps the feed unavailable; do not bypass regional restrictions.
- The adapter is a data bridge, not evidence that a setup is profitable. Existing quote, spread, trend, squeeze, entry, news, risk, approval and untouched-holdout gates remain in force.
