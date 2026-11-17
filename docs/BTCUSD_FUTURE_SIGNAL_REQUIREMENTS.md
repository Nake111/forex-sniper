# BTC/USD Future Signal Requirements

Status: PAPER / RESEARCH ONLY. This document records the BTC/USD approval requirements for future signal runs. It does not authorize a trade.

## Last verified BTC/USD run

- Source: `dashboard/data/signals.json`
- Analysis cycle: `2026-11-17T23:06:05Z` (Europe/Ljubljana: 2026-11-18 00:06:05)
- Decision: `NO APPROVED TRADE`
- Directional candidate: BUY (research only)
- Five-agent votes: BUY 3/5; hpFX and Gann/Hurst returned NO_SIGNAL.
- Layer 2: PASSED; Layer 3: REJECTED.
- Watchdog: PASS for that run only.
- Candidate plan: entry 64,908.12; stop 64,622.97; target 65,303.45; R:R 1:1.39. Historical values only; do not reuse as live levels.
- Quote at that cycle: Coinbase BTC-USD bid 64,923.60 / ask 64,923.61 with provider timestamp. Historical quote only.

## Blockers to clear before any future BUY or SELL publication

1. Obtain synchronized, fresh, closed M5 candles and fresh provider-timestamped bid/ask quotes for BTC/USD. Record source, venue, provider timestamp, receive timestamp, quote age, spread and snapshot identity.
2. Re-run the full five-agent analysis on the same analysis cycle. Require at least 3 of 5 independent directional votes and at least 60% reliability-weighted support.
3. Require independent market-intelligence confirmation and independent signal-approval confirmation. A five-agent directional consensus alone is not approval.
4. Require M5 trigger confirmation plus H1 squeeze/momentum confirmation in the same direction. Reject a BUY/SELL if higher-timeframe confirmation is absent or contradictory.
5. Recalculate the entry using the current executable side of the quote. Reject entry chasing when quote-to-reference drift exceeds 0.25 ATR.
6. Require verified spread/ATR within the BTC/USD configured limit and a complete entry, stop-loss and take-profit plan.
7. Require realistic net reward/risk of at least 1:2 after spread, commission and slippage. Do not widen stops or move targets merely to force the ratio.
8. Keep the final 30% chronological holdout locked until candidate settings are frozen. Do not tune on holdout data.
9. Keep forward-paper validation active until at least 30 resolved trades exist; require positive net expectancy and profit factor >= 1.1 before performance approval.
10. Run the publication watchdog. Any failed, missing, stale, inconsistent or unverified gate must publish `NO APPROVED TRADE`, not a directional BUY/SELL instruction.

## Publication rules

- PAPER / RESEARCH ONLY. No broker integration and no live orders.
- Do not reuse historical prices or quote snapshots as current levels.
- Publish BUY or SELL only when every required gate above passes on the same fresh analysis cycle.
- Otherwise publish `NO APPROVED TRADE` and list the exact failed gates.
- Keep all five-agent adapters diagnostic until independently calibrated; do not infer win probability from heuristic candidate strength.

## Next run checklist

- [ ] Refresh BTC/USD M5 candles and provider-timestamped bid/ask quote.
- [ ] Verify candle synchronization, quote freshness, spread and quote identity.
- [ ] Run five agents and independent market-intelligence / approval checks.
- [ ] Verify M5 + H1 confirmation and no entry chasing.
- [ ] Verify complete plan and >= 1:2 net R:R.
- [ ] Preserve training/holdout separation and update resolved forward-paper trade count.
- [ ] Pass watchdog before publication.
