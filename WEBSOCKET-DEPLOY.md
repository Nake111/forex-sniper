# Persistent BTC WebSocket collector

## What it does

- Connects to Binance's public market-data WebSocket endpoint.
- Streams BTCUSDT aggregate trades, best bid/ask and closed 5m, 15m and 1h candles.
- Keeps rolling candle history in `/app/data` (Render persistent disk).
- Updates `data/online-market.json` with latest trade, bid/ask, spread and 24h statistics.
- Runs the combined signal engine after candle closes.
- Reconnects with exponential backoff after errors, detects silent connections, responds to ping frames, and proactively rotates the connection after 23h50m (Binance enforces a 24-hour connection lifetime).
- Commits the latest candle history, market snapshot and signal report to branch `Btcusd` approximately every five minutes using the GitHub Git Data API.

## Deploy on Render

1. Push this branch to GitHub (already committed with this implementation).
2. Create/sign in to a Render account and connect the `Nake111/forex-sniper` repository.
3. In Render choose **New → Blueprint** and select branch `Btcusd`; Render reads `render.yaml`.
4. Create a fine-grained GitHub token for this repository with **Contents: Read and write** permission. Do not put it in source code or commit it.
5. Enter that token as the Render service's `GITHUB_TOKEN` environment variable.
6. Confirm the paid background worker and 1 GB persistent disk, then deploy.

The worker is configured as a paid Render background worker with persistent disk. Render documents that persistent disks are available on paid services and preserve files across restarts/deploys. A persistent worker cannot be provisioned from this repository alone: the owner must approve the Render account, billing plan and secret token.

## Local run

```bash
npm install
npm run start:stream
```

For GitHub commits locally, set `GITHUB_TOKEN` in the environment. Without it, live data still writes to the local `data/` directory but will not be pushed to GitHub.

## Feed and instrument caveat

The feed is Binance BTCUSDT spot, not Vantage BTCUSD CFD. The bot is market-data-only and never places orders. Compare spot reference prices with the Vantage quote before making any manual decision.

Official Binance stream documentation: https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md
Render persistent disk documentation: https://render.com/docs/disks
Render background workers: https://render.com/docs/background-workers
