# TradingView integration

## 1. Dashboard charts
The dashboard embeds TradingView charts for OANDA:EURUSD, BINANCE:BTCUSDT and OANDA:XAUUSD. TradingView chart feeds may differ from the data feed used by Forex Sniper.

## 2. Deploy the webhook Worker (one-time)
The Worker source is in `tradingview-worker/src/index.js`; it is not deployed automatically by GitHub.

1. Sign in to Cloudflare and open **Workers & Pages**.
2. Choose **Create application** → **Create Worker** and give it a name such as `forex-sniper-tv`.
3. Choose **Edit code**. Replace the starter code with the full contents of `tradingview-worker/src/index.js` from this repository, then **Deploy**.
4. Open the Worker → **Settings** → **Variables and Secrets**.
5. Add a **Secret** named `TV_WEBHOOK_SECRET`. Use a long random value (at least 32 random characters). Save it privately.
6. Add a **Secret** named `GITHUB_TOKEN`. This must be a GitHub fine-grained personal access token for only `Nake111/forex-sniper`, with **Contents: Read and write** permission. GitHub requires Contents write for repository dispatch. Never paste this token into TradingView or chat.
7. Add a plain-text **Variable** named `GITHUB_REPOSITORY` with value `Nake111/forex-sniper`.
8. Deploy the Worker settings. Your webhook URL is `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/WEBHOOK_SECRET`, where the final path segment is the exact `TV_WEBHOOK_SECRET` value. Keep this URL private; rotate the secret if exposed.

The Worker also checks the sender IP against TradingView's published webhook IP list. TradingView publishes these addresses in its webhook documentation; IP allowlisting is an additional filter, not cryptographic proof of origin.

## 3. Add the Pine Script indicator
1. Open TradingView in a browser and sign in.
2. Open a chart and select the symbol:
   - `OANDA:EURUSD`
   - `BINANCE:BTCUSDT`
   - `OANDA:XAUUSD`
3. Open **Pine Editor** at the bottom of the chart.
4. In GitHub, open `tradingview/forex-sniper-alerts.pine`, copy all the code, paste it into Pine Editor, and select **Save**.
5. Select **Add to chart**.
6. Repeat for each market chart. Choose the timeframe you want to monitor (start with 15 minutes).

## 4. Create the alert
1. Click **Alert** (clock icon) in TradingView.
2. In Condition, select **Forex Sniper Confirmation Alerts**.
3. Select **Any alert() function call**.
4. Enable **Webhook URL** and paste the Cloudflare Worker URL from step 2, including the secret path.
5. Create the alert. Keep the alert active. Repeat for each symbol/timeframe you want.
6. TradingView requires two-factor authentication to use webhook alerts. Webhook alerts may also depend on your TradingView subscription. See TradingView's official guide.

## 5. Confirm it works
When the indicator produces a BUY or SELL on a closed candle, TradingView sends JSON to the Worker. The Worker checks the path secret and TradingView source IP, then sends a `tradingview_alert` repository dispatch. GitHub Actions should start **Forex Sniper Analysis**.
Check GitHub → Actions for a new run. A valid alert is an input for analysis only; it does not place orders and does not bypass Forex Sniper's risk filters.

## Official setup references
- TradingView webhook setup: https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/
- Cloudflare Worker secrets: https://developers.cloudflare.com/workers/configuration/secrets/
