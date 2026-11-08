# TradingView chart-data bridge

Forwards closed-candle chart snapshots into the Forex Sniper GitHub Actions run. It does not grant ChatGPT direct access to your private TradingView account or chart UI.

## Data
Ticker, timeframe, candle timestamp, OHLC, volume, EMA20/EMA50, RSI14, ATR14 and a simple BUY/SELL/HOLD trend label. The local Forex Sniper analysis remains authoritative; TradingView can confirm or veto a local candidate, but cannot promote HOLD.

## Setup
1. Create a fine-grained GitHub token for owner Nake111, restricted to this repository, with **Contents: Read and write**. Keep it private.
2. Deploy a Cloudflare Worker using tradingview-worker/src/index.js.
3. Add Worker secrets GITHUB_TOKEN and TV_WEBHOOK_SECRET (a unique random value of at least 32 characters), plus variable GITHUB_REPOSITORY=Nake111/forex-sniper.
4. Webhook URL: https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/YOUR_SECRET. Keep it private.
5. In TradingView open OANDA:EURUSD, BINANCE:BTCUSDT (USDT proxy), or OANDA:XAUUSD. Paste tradingview/forex-sniper-alerts.pine into Pine Editor, save and add to chart.
6. Create an alert for this indicator and select "Any alert() function call". Enable Webhook URL and paste the Worker URL. Repeat per symbol/timeframe.
7. Confirm a GitHub Actions run named Forex Sniper Analysis and inspect its signal artifact.

TradingView webhook availability may depend on account plan and 2FA. Alerts send snapshots only on confirmed candle closes. Never put credentials in Pine code, GitHub files, or alert message bodies.
