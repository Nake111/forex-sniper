# TradingView integration

## Dashboard charts
The Quant Swarm dashboard embeds TradingView charts for OANDA:EURUSD, BINANCE:BTCUSDT and OANDA:XAUUSD. TradingView supplies chart data; its feed may differ from the candle feed used by Forex Sniper.

## Pine Script alerts
1. Open TradingView → Pine Editor.
2. Copy `tradingview/forex-sniper-alerts.pine` into a new indicator and add it to a chart.
3. Suggested symbols: OANDA:EURUSD, BINANCE:BTCUSDT and OANDA:XAUUSD.
4. In indicator settings, enter a unique high-entropy value in **Webhook shared secret**.
5. Create an alert using **Any alert() function call**, once per bar close.
6. Set the alert webhook URL to the deployed Cloudflare Worker URL.

## Deploy webhook bridge
The Worker is source code only; it is not deployed automatically by GitHub. Deploy from `tradingview-worker`:
```sh
cd tradingview-worker
npx wrangler deploy
npx wrangler secret put TV_WEBHOOK_SECRET
npx wrangler secret put GITHUB_TOKEN
```
Set the Cloudflare Worker variable `GITHUB_REPOSITORY=Nake111/forex-sniper`. The GitHub fine-grained token needs **Actions: read/write** and **Contents: read** access to this repository. Keep the webhook secret private; TradingView alert configuration contains it. Never reuse your GitHub token as the webhook secret.

## What happens
The Worker validates the JSON shared secret and forwards valid alerts as GitHub `repository_dispatch` events (`tradingview_alert`). The Forex Sniper analysis workflow then runs. This is alert ingestion and research only; no orders are sent. The TradingView alert is an additional input, not an automatic override of the multi-timeframe risk gates.

## Limitations
TradingView chart embedding is available without a TradingView API key. TradingView webhooks require an eligible TradingView plan/account feature. The webhook Worker requires a Cloudflare account and deployment, plus a GitHub token stored as a Worker secret. TradingView alerts are not a substitute for broker quotes, spread checks or execution confirmation.
