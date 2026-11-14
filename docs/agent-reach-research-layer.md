# Agent-Reach research layer (paper-only)

Agent-Reach is an optional, read-only research source for public web, GitHub, Reddit, YouTube and other supported platform content. It is not a live market-data feed, broker quote source, candle provider or trade-approval engine.

## Allowed use
- Gather dated macroeconomic commentary, public news links and market narratives.
- Collect public trader discussion as low-weight contextual sentiment.
- Preserve source URL, author/publisher and publication time when available.
- Mark the source unavailable when Agent-Reach or a platform cannot be reached.
- Discover supported actions with `agent-reach channels`; use only documented read/search actions.

## Prohibited use
- Never derive bid/ask, spread, executable price, candle OHLC or provider timestamps from social posts or article text.
- Never let sentiment, an influencer call, a search result or an LLM override candle, quote, spread, M5 trigger, risk/reward, macro-event or independent approval gates.
- Never convert an external BUY/SELL opinion into a Forex Sniper signal.
- Never install browser cookies, request credentials, post, comment, message or place orders as part of this integration.

## Approval boundary
Agent-Reach output may be attached to the research report as non-voting context only. The deterministic market engine and independent approval agents remain authoritative. A paper BUY/SELL still requires a current provider-timestamped bid/ask snapshot, valid market-specific spread/ATR, a closed M5 trigger, a correctly priced entry/stop/target and at least 1:2 effective risk/reward. Otherwise publish `NO APPROVED TRADE`.

## Runtime
Do not make Agent-Reach a required dependency of the scheduled GitHub Actions signal pipeline. Its optional platform backends can require separate setup, login or third-party tools; a research-source outage must not stop market-data refresh or weaken trade validation. Enable a source only after its documented action and health check have been verified.
