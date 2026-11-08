# TradingView integration

## Dashboard charts
The Quant Swarm dashboard embeds TradingView charts for OANDA:EURUSD, BINANCE:BTCUSDT and OANDA:XAUUSD. TradingView supplies chart data; it may differ from the broker/data feed used by Forex Sniper.

## Pine Script alerts
1. Open TradingView → Pine Editor.
2. Copy `tradingview/forex-sniper-alerts.pine` into a new indicator and add it to a chart.
3. Use the appropriate symbol/feed (suggested: OANDA:EURUSD, BINANCE:BTCUSDT, OANDA:XAUUSD).
4. Create an alert using **Any alert() function call**, once per bar close.
5. Set the alert webhook URL to your deployed Cloudflare Worker URL.
6. In the alert's message field, TradingView will send the JSON created by Pine's `alert()` calls. The worker authenticates with the `X-Webhook-Secret` header; TradingView's native webhook UI does not support arbitrary custom headers. Therefore, to use the worker safely, set a high-entropy secret in the JSON payload and configure `TV_WEBHOOK_SECRET` in the Worker. Replace the Pine alert JSON by adding `"secret":"YOUR_SECRET"` only if you accept that it will be visible in your TradingView alert configuration. Prefer a unique secret and rotate it if exposed.

## Deploy the webhook bridge (one-time setup)
The Worker is not deployed by GitHub. Deploy it from the repo's `tradingview-worker` directory using Cloudflare Wrangler:
```sh
cd tradingview-worker
npx wrangler deploy
npx wrangler secret put TV_WEBHOOK_SECRET
npx wrangler secret put GITHUB_TOKEN
```
Set a GitHub fine-grained token with **Actions: read/write** and **Contents: read** access to this repository, and set Worker variable `GITHUB_REPOSITORY=Nake111/forex-sniper` in Cloudflare Worker settings. The webhook currently expects the shared secret in the `X-Webhook-Secret` header; because TradingView alerts cannot set custom headers, a small relay/proxy that adds this header is required, or adapt the worker to validate a secret field in the JSON body before deployment. Do not deploy the current header-authenticated endpoint directly as a TradingView webhook until that adaptation is made.

## Alert handling
Authenticated alerts are forwarded as GitHub `repository_dispatch` events with type `tradingview_alert`. The analysis workflow is triggered by those events. This is alert ingestion for research only; it does not submit orders. TradingView alerts are a separate confirmation input and must not be treated as guaranteed entries.
