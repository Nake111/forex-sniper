# Forex Sniper — EUR/USD + BTC/USD + XAU/USD

A Node.js market-analysis and paper-signal project for **EUR/USD**, **BTC/USD** and **XAU/USD**. It analyses closed M5, M15 and H1 candles and prints a separate signal report for each market.

## What it does

- Downloads historical M5, M15 and H1 candles from Dukascopy using `dukascopy-node`.
- Calculates EMA 20/50, RSI 14, MACD, ATR, volume profile (POC/VAH/VAL), market structure and squeeze momentum.
- Tracks London, New York, Tokyo and Sydney sessions, active-session high/low ranges, London/New York overlap, and breakouts above/below the range formed by earlier candles in the active session. Session data is informational and does not force trades; BTC/USD remains tradable around the clock.
- Session hours use a fixed UTC offset by default. Set `SESSION_UTC_OFFSET` to an integer UTC offset if you want to shift the session clock; daylight-saving changes are not automatic.
- For BTC/USD, reads Deribit public options data and reports nearest-expiry call/put open-interest walls, options-volume concentration, OI-weighted IV concentration, max pain and an unsigned gross-gamma proxy.
- Keeps options positioning as supplemental context; it does not independently trigger BUY/SELL.
- Evaluates each market independently and prints `BUY`, `SELL` or `NO TRADE`.
- Produces an ATR-based entry, stop-loss and take-profit only when the M5/M15 setup and H1 confirmation align.
- Includes unit tests for signal direction, confirmation logic and options-wall calculations.

**Options data limitations:** Deribit public open interest is delayed by 8 hours. Open interest does not reveal dealer long/short positioning, so the gamma figure is an unsigned approximation, not signed dealer GEX. BTC options levels must not be treated as guaranteed support/resistance. The current free data setup does not provide a consolidated listed-options chain for EUR/USD.

**Safety:** this project is analysis-only. It does not connect to Vantage or place live orders. A BUY/SELL output is not a guarantee of profitability. Validate performance with realistic spreads, commissions, slippage and out-of-sample testing before risking money.

## Economic-news engine and Forex Factory reference

The engine uses the authenticated Finance Calendar REST API as its structured economic-event source. Forex Factory remains a manual calendar reference only; this project does not scrape, copy or redistribute Forex Factory schedules. See the provider's [API documentation](https://www.financecalendar.com/api/forex-calendar/) and [service terms](https://www.financecalendar.com/api/terms/).

Configure the repository secret **`FINANCE_CALENDAR_API_KEY`** under Settings → Secrets and variables → Actions. The key is sent only from the GitHub Actions runner in the `X-API-Key` header and is never written to dashboard JavaScript or committed files. The provider currently requires an activated account and API key for programmatic access; check its current plan and source coverage before enabling it.

The engine requests high- and medium-impact releases for USD, EUR/eurozone, GBP, JPY, CAD, AUD, CHF and NZD for a rolling 17-day window. It normalizes UTC release timestamps, event status, impact, source provenance, actual, consensus and prior values. When actual and consensus are both numeric and comparable, it reports the numerical difference only; it never assumes that an above-consensus print is automatically bullish for that currency.

Risk controls:
- High-impact events block new entries 15 minutes before through 15 minutes after release.
- Medium-impact events block new entries 5 minutes before through 5 minutes after release.
- High-impact events with no verified release time on the publisher's local date block entries for that date.
- Cancelled events are ignored. Stale records and incomplete pagination cannot be treated as clean calendar clearance.
- If the API key is missing, the feed fails, the response is invalid, or coverage is incomplete, calendar risk is `UNKNOWN` and the signal engine and portfolio risk agent force `HOLD`.
- The calendar is checked once per signal run and shared across EUR/USD, BTC/USD and XAU/USD. A private GitHub Actions cache reuses a verified snapshot for at most nine minutes, reducing API calls while the five-minute candle workflow runs. The cache is stored outside public dashboard artifacts. News headlines remain context only and do not replace scheduled-release data.

The public dashboard continues to link to Forex Factory for discretionary verification. Do not claim the dashboard or signal engine has Forex Factory's data. A live run can only be considered calendar-enabled after the API secret is configured and a successful Actions report shows `ECONOMIC CALENDAR STATUS: AVAILABLE`.

## Session context and source licensing

The session module is an independent implementation of common market-session timing and range calculations. It does not include LuxAlgo source code. The LuxAlgo Pine Script supplied as a reference by the project owner is marked CC BY-NC-SA 4.0; do not copy or redistribute that source, or use a derivative of it commercially, unless the license terms permit it.

## Multi-agent decision layer

The signal engine includes a TradingAgents-inspired, deterministic multi-agent layer for all three markets. This is an original JavaScript adaptation of the workflow pattern, not a direct port of the Python/LangGraph project, and it does not require paid LLM API keys.

- Specialist agents: technical trend, momentum, SMC/liquidity, macro/news, and volume/auction context.
- Bull/bear research debate: independent directional scores and supporting evidence are included in each report.
- Trader: converts the analyst balance into a directional bias and consensus score.
- Risk manager: can veto high-impact news and abnormal volatility.
- Portfolio manager: approves BUY/SELL only when the agent decision agrees with the existing technical signal.
- The agent layer can only confirm or veto a technical candidate; it never turns a technical HOLD into a trade.

This layer is a second opinion and safety gate, not proof of profitability. It is rule-based rather than LLM-powered; news sentiment remains contextual and the macro analyst does not guess a direction from headlines. Backtest the added gate independently before relying on its results.

## Requirements

- Node.js 20+
- npm
- A Finance Calendar API key in `FINANCE_CALENDAR_API_KEY` for automated event-risk clearance

## Setup

```bash
npm install
npm run check
npm test
```

## Download market data

Downloads 180 days by default for both instruments and all three timeframes:

```bash
npm run download
```

To change the download period (30–730 days):

```bash
DATA_DAYS_BACK=90 npm run download
```

The six datasets are saved under `data/`:

- `eurusd-m5.json`, `eurusd-m15.json`, `eurusd-h1.json`
- `btcusd-m5.json`, `btcusd-m15.json`, `btcusd-h1.json`

## Run both signal engines

```bash
npm start
```

The output contains separate EUR/USD and BTC/USD reports. BTC options context is fetched from Deribit public endpoints; if that service is unavailable, spot analysis continues without it. If one market is missing valid candle data, the other market is still analysed; the process exits with an error status so the missing dataset is visible.

## Scheduled live candle refresh

The separate `.github/workflows/live-candle-refresh.yml` workflow runs on manual dispatch and a five-minute schedule. Each run restores a cached candle history, refreshes the latest overlapping window, validates and deduplicates candles, generates a timestamped EUR/USD, BTC/USD and XAU/USD signal report, then uploads the candle files and report as a seven-day artifact.

**Important live-data limits:** GitHub Actions is a scheduled polling service, not an always-on streaming server. GitHub documents five minutes as the shortest scheduled interval, and scheduled starts can be delayed. BTC/USD candles use Kraken XBT/USD spot OHLC (not a broker CFD quote); EUR/USD and XAU/USD use Dukascopy historical candle downloads unless a Twelve Data key is configured. These are reference feeds, not Vantage bid/ask execution prices. The report's candle-age safety gate must be respected. For true uninterrupted tick streaming, deploy the reconnecting workers to an always-on host; GitHub-hosted runners stop when each job ends. The BTC worker is `npm run live:btc`: it reconnects to Binance BTCUSDT 1-minute klines, bootstraps 15,000 closed M1 candles, aggregates M5/M15/H1/H4, and writes `data/btcusd-*.json` paths consumed by the signal engine when `BTC_DATA_PREFIX=btcusd`. The gold reference worker is `npm run live:gold` and requires `TWELVE_DATA_API_KEY`; it is reference data, not a Vantage quote. Add `TWELVE_DATA_API_KEY` under GitHub Settings → Secrets and variables → Actions to let the scheduled candle refresh use Twelve Data for EUR/USD and XAU/USD, with Dukascopy fallback if the provider fails. No live orders are placed.

The latest scheduled output is available under **Actions → Forex Sniper Live Candle Refresh → latest run → Artifacts**. The existing longer validation workflow remains separate so it does not block the five-minute refresh cadence.

## GitHub Actions

Open **Actions → Forex Sniper Analysis → Run workflow** to install dependencies, run syntax checks and tests, download fresh candles, and create a report artifact.

## Backtest

Run the BTC/USD historical simulation (default):

```bash
npm run backtest
```

Run EUR/USD:

```bash
MARKET=EURUSD npm run backtest
```

The default round-trip cost assumptions are 10 basis points for BTC/USD and 0.5 basis points for EUR/USD. Override with `BACKTEST_COST_BPS` to model your own estimated spread and fees. These are assumptions, not a quote from your broker.

## Tests

```bash
npm test
npm run check
```

The default `balanced` profile labels A+ (strong), B (qualified) and C (HOLD) setups. It distinguishes trend continuation from pullback/reversal context. B-tier signals are not automatic orders: H1 momentum confirmation, local agent agreement, stale-data checks, macro risk and optional Gemini veto still apply. A reversal label describes the setup context, not a guarantee that a higher-timeframe trend has reversed. Compare `SIGNAL_PROFILE=baseline`, `balanced`, `institutional` and the stricter profiles using chronological holdout tests before relying on any change. A HOLD / NO TRADE result remains correct when confirmation or risk checks fail. No profile guarantees profitability.


## Quant Swarm dashboard

A separate browser dashboard is available in [dashboard/](dashboard/). It connects directly to public Binance BTC/USDT ticker, 1-minute candle and depth WebSocket streams, then calculates six transparent rule-based votes (trend, momentum, Aroon, order flow, quant candle and Bayesian ensemble). It also discovers an active BTC Up/Down market from Polymarket's public Gamma API and reads the two outcome token books from the public CLOB API when available.

- Dashboard source: [dashboard/index.html](dashboard/index.html)
- GitHub Pages deployment: [Deploy Quant Swarm Dashboard](.github/workflows/deploy-dashboard.yml)
- Paper trading only: the local ledger is stored in the browser; it is not a verified exchange account balance or audited backtest.
- Polymarket outcome token ordering and market availability can change; unavailable quotes are shown as unavailable rather than inferred.
- The six dashboard votes are deterministic indicators, not six independent LLMs. The optional six-agent Gemini research layer can be enabled with a Gemini API key; deterministic indicators and research agents continue without it.
- No live orders, wallet connection, deposits, or withdrawals are supported.

After the Pages workflow succeeds, enable/open the site from Repository Settings → Pages. The expected project URL is https://nake111.github.io/forex-sniper/ if GitHub Pages is available for this repository.


## Polymarket + Gemini Quant Swarm additions

- `src/llm-agents.js`: six independent Gemini role prompts (technical, structure, quant, macro, risk, contrarian) using Google's Gemini Developer API. Configure the GitHub Actions secret `GEMINI_API_KEY`; optionally set `GEMINI_MODEL` (default `gemini-3.5-flash-lite`) and `LLM_TIMEOUT_MS`.
- Gemini 2.5 Flash currently has a free API tier, subject to model availability, quota and rate limits. Free-tier content may be used by Google to improve products; do not send private or sensitive information. Check Google's current pricing and terms before use.
- Six separate Gemini requests are made sequentially with pacing for each market to reduce free-tier rate-limit bursts. The six-agent aggregator requires all six valid responses and at least four BUY or four SELL votes; any failed agent or explicit veto forces HOLD. The signal engine runs this consensus independently for EUR/USD, BTC/USD and XAU/USD and only uses it to confirm or veto the deterministic candidate. Without a key, it stays disabled and the deterministic research agents remain active.
- `src/polymarket-quant.js`: read-only BTC Up/Down market discovery, outcome-token mapping by labels, current bid/ask context and seconds-to-expiry. The exact settlement reference/strike is not inferred from the question title; expiry direction is not promoted to an executable signal.
- `src/polymarket-backtest.js`: run `npm run backtest:polymarket`. This first-pass test uses public CLOB token-price history, transparent fee/slippage assumptions and next-sample mark-to-market. It is not resolution-based PnL, does not reconstruct historical order books or actual fills, and must not be presented as verified profitability.
- `tests/polymarket-quant.test.js` and `tests/llm-agents.test.js`: safety tests for expiry handling, outcome mapping and no-key behavior.
- `.github/workflows/quant-swarm-check.yml`: validates the new modules on main-branch changes.

To enable Gemini, create an API key in [Google AI Studio](https://aistudio.google.com/) and add it as `GEMINI_API_KEY` under GitHub repository Settings → Secrets and variables → Actions. Never put the key in dashboard HTML, source files, logs or committed `.env` files. LLM output is treated as untrusted research and can only veto/confirm an existing candidate; it cannot place orders.

### Expiry forecasting and performance audit

The BTC Up/Down context now includes an explicitly labeled expiry-time probability proxy. It estimates P(UP) from a Binance BTCUSDT 1-minute candle at the market start timestamp and recent 1-minute log-return drift/volatility. This is only a spot proxy: Polymarket may settle against a Chainlink/reference feed, and the start timestamp/candle alignment may differ. The system reports the reference price, assumptions and limitations; do not treat the probability as calibrated or executable.

`src/performance-audit.js` computes compounded return, win rate with a Wilson 95% interval, profit factor, maximum drawdown and chronological in-sample/holdout summaries. `npm run backtest:polymarket` saves the raw trades and audit to `reports/polymarket-backtest.json`. The current Polymarket backtest still marks the next observed token-price sample rather than resolved-contract outcomes or executable historical fills, so its results are exploratory only.
