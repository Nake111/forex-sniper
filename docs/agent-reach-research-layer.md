# Agent-Reach research layer (paper-only)

Agent-Reach is now an optional read-only enrichment step in the main signal workflow. Forex Sniper first discovers public headlines using its existing news providers, then asks Agent-Reach to read up to two article URLs and attach short source excerpts to the market macro context.

## Runtime integration
- `src/agent-reach-research.js` invokes the documented `agent-reach read <URL>` command and parses its JSON result.
- `src/index.js` attaches the result to each market's macro context and logs its status.
- `src/llm-agents.js` supplies bounded excerpts to the macro specialist, explicitly marked as untrusted external text.
- `.github/workflows/forex-sniper.yml` installs the Agent-Reach CLI into the ephemeral GitHub Actions runner with `pipx`. It runs the safe/check-only installer mode; no system dependencies, browser sessions, cookies or login channels are installed.
- `AGENT_REACH_ENABLED=false` disables the reader. If the CLI or source is unavailable, the adapter reports `UNAVAILABLE` and analysis continues.

## Signal and data boundary
Agent-Reach output is research context only (`researchOnly: true`, `voteWeight: 0`, `canApproveSignal: false`). It may help the macro reviewer understand an article body, but it cannot:
- provide or replace bid/ask, spread, executable price, candle OHLC or provider timestamps;
- change the technical candidate, quote validation, spread/ATR, calendar, closed-M5 trigger, stop/target geometry or reward/risk checks;
- approve a BUY/SELL, override independent approval, or authorize a broker order;
- perform any write action, login, cookie import, post, comment, message or trade.

Article text is untrusted. The LLM reviewer is instructed to ignore instructions embedded in retrieved pages and treat excerpts only as source evidence. Excerpts are truncated and retain the source URL, author and publication time when supplied.

## Fail-closed behavior
A paper BUY/SELL still requires the existing provider-timestamped quote, market-specific spread/ATR validation, closed M5 entry trigger, complete quote-priced entry/stop/target, minimum 1:2 effective risk/reward and independent approval. Otherwise publish `NO APPROVED TRADE`.

Agent-Reach is not a required dependency: an unavailable reader must never stop candle refresh or weaken any trading safety gate. The workflow installs only the CLI and invokes the official safe/check-only mode. It does not configure optional authenticated channels.
