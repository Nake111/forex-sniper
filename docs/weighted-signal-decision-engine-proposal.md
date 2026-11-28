# Forex Sniper — Weighted Signal Decision Engine Proposal

**Status:** Proposal for implementation and validation  
**Markets:** EUR/USD, BTC/USD, XAU/USD  
**Architecture:** Existing three-layer engine (discovery → verification → execution approval)  
**Safety principle:** Increase valid opportunities by improving evidence handling, not by weakening risk controls or forcing trades.

## 1. Objective

The current engine can discover directional evidence and then reject it because of overlapping agent votes, unavailable confirmation fields, market-specific rules leaking into other markets, or quote-quality problems. The proposed design separates:

1. A directional candidate.
2. A scored technical verification.
3. A hard risk/execution decision.

A candidate is not an approved trade. No layer may fabricate prices or treat missing data as a pass.

## 2. Three-layer decision flow

### Layer 1 — Opportunity discovery

- Evaluate M5, M15, H1 and H4 independently.
- Preserve BUY/SELL candidates even if a later layer rejects them.
- Record each timeframe's direction, regime, closed-candle timestamp and source.
- A neutral or unavailable timeframe is not automatically a directional vote.
- Discovery may use trend, momentum, BOS/CHOCH, liquidity sweep, order-block/FVG context, VWAP and volume-derived proxies.

Output: candidate direction, setup type, timeframe evidence, timestamp and candidate invalidation level.

### Layer 2 — Weighted verification (0–100)

Initial research weights; these are calibration starting points, not proven optimal thresholds.

| Evidence group | Weight | What it evaluates |
|---|---:|---|
| H1/H4 trend and structure | 25 | Regime, EMA alignment, swing structure, BOS/CHOCH |
| M15 momentum and confirmation | 20 | RSI/MACD/momentum, close location, continuation or reversal |
| M5 entry trigger | 20 | Closed-bar trigger, retest, rejection, breakout/reclaim |
| Liquidity / SMC evidence | 15 | Liquidity sweep, displacement, OB/FVG context, nearby levels |
| Quote and spread quality | 10 | Fresh bid/ask, spread relative to ATR and market profile |
| Volatility and session | 10 | ATR regime, session liquidity and abnormal conditions |
| **Total** | **100** | |

Initial score bands:

- **75–100:** eligible to proceed to Layer 3, subject to every hard gate.
- **65–74:** watchlist; wait for a stronger trigger or better quote.
- **Below 65:** reject for now.

Scoring requirements:

- Each evidence group returns PASS, FAIL or UNAVAILABLE, with a reason and source.
- Normalize only across explicitly available evidence; never award points for missing inputs.
- Publish raw score and coverage (available weight / 100). Insufficient coverage prevents approval.
- Correlated indicators must not be counted as independent confirmations (for example, RSI and MACD are both momentum evidence).
- LLM/agent outputs are advisory. A timeout, 503 or disagreement must not independently erase a technically valid candidate.
- Agents explain evidence and confidence; they do not each have an unconditional veto.
- Hard deterministic risk gates remain authoritative.

### Layer 3 — Risk and execution approval

Approval requires all of the following:

1. Fresh, valid bid and ask for the relevant instrument and venue; ask > bid.
2. Quote age within a market-specific freshness limit.
3. Spread within a market-specific spread/ATR limit.
4. Entry derived from the current quote and a defined setup; not from a stale candle close alone.
5. Stop-loss on the correct side of entry and beyond a defensible invalidation point.
6. Take-profit on the correct side of entry and minimum risk/reward satisfied.
7. Position size calculated from account equity, stop distance, contract specification and permitted risk.
8. No hard event-risk, data-integrity or portfolio-risk veto.
9. Closed-bar trigger confirmed when required by that market's strategy.
10. Explicit execution venue/account connectivity before describing an order as executable.

If the venue is not connected, the engine may label a fully validated setup PAPER SIGNAL APPROVED. It must never imply a broker order was placed.

## 3. Hard gates versus advisory evidence

### Hard vetoes

- Missing, malformed, crossed or stale bid/ask.
- Spread beyond the instrument's calibrated maximum.
- Invalid/missing stop or target.
- Stop/target on the wrong side of the proposed entry.
- Position size cannot be calculated safely.
- Required candle data is stale or incomplete.
- Market-specific mandatory trigger is not confirmed.
- Active high-impact event inside the market-specific blackout window, unless a separately tested event strategy is enabled.
- Portfolio risk limit, daily loss limit or exposure limit breached.

### Advisory / scored evidence

- Specialist or quantitative-agent vote count.
- LLM opinion, sentiment or narrative.
- Non-mandatory timeframe disagreement.
- Secondary news/calendar provider outage when a trusted primary source is available and checked.
- Order-flow proxies inferred from candle location, OBV, MFI or CVD approximations.

Advisory disagreement reduces score or confidence; it does not become a veto by itself. Missing data remains visible and may reduce score coverage enough to prevent approval.

## 4. Market-specific calibration

Do not apply one market's rule set to another. Store thresholds in separate profiles and calibrate them from historical and out-of-sample data.

### EUR/USD

- Prioritize H1/M15 direction and a closed M5 pullback/reclaim trigger.
- Enforce a strict spread/ATR ceiling using a fresh executable quote.
- Recalculate entry, stop and target using current bid/ask, pip size and ATR.
- Reject when quote quality is poor even if directional score is high.

### BTC/USD

- Detect H1 volatility squeeze and release using closed H1 bars.
- Distinguish an active squeeze from a confirmed release.
- Require direction agreement between release, H1 regime and M5/M15 trigger.
- Use crypto-specific spread, volatility, session and venue freshness limits.

### XAU/USD (Gold)

- Separate an upcoming calendar event, an active event and recent headline caution.
- A recent headline alone is not the same as an active high-impact calendar event.
- Verify the primary economic calendar; disclose secondary-provider outages.
- Require M15/H1 structure and a closed M5 trigger, with gold-specific spread and ATR rules.

All thresholds (spread/ATR, quote age, event blackout, ATR regime, minimum score coverage) must be estimated and tested per instrument and data provider. Do not guess them or copy EUR/USD limits into BTC or Gold.

## 5. Risk policy for initial paper validation

Suggested conservative starting policy:

- Risk budget: 0.5% of account equity per trade in paper/simulation tests.
- Absolute configured cap: 1% per trade; never exceed it.
- Minimum planned reward/risk: 2.0, after estimated spread and fees.
- Enforce daily loss, concurrent position and correlated exposure limits.
- No averaging down or widening a stop after entry.
- Include slippage, spread, commissions, funding and swap where applicable.

These are proposed controls, not a promise of profitability. Real-money risk settings require user/broker-specific contract details and separate approval.

## 6. Entry plan output contract

For every candidate, including rejected ones, expose:

- market, direction, setup, candidateStatus
- candidateScore, scoreCoverage, component scores and evidence
- quote.bid, quote.ask, quote.spread, quote.source, quote.timestamp, quoteAgeMs
- entry, stopLoss, takeProfit, riskReward, positionSize
- verificationStatus, executionStatus
- hardBlockers[], advisories[], missingData[]
- candleTimestamps and generatedAt

If a quote or plan is unavailable, show the field as unavailable/null and explain why. Do not substitute a candle close as a live entry.

## 7. Implementation sequence

1. Audit current schemas and fix integration mismatches in the existing three-layer module. Verify actual shapes of market review, quote, plan, approval and entry-verification objects before reading their properties.
2. Fix EUR/USD bid/ask freshness and spread/ATR validation.
3. Fix BTC H1 squeeze-state versus confirmed-release logic.
4. Fix Gold calendar event classification and headline-caution handling.
5. Add weighted score and coverage output; remove agent-count vetoes except where a deterministic, independently tested rule requires them.
6. Ensure entry/SL/TP are computed from a valid quote and invalidation structure before final approval display, while marking them provisional until all gates pass.
7. Add unit and integration tests for each market, unavailable data, stale quotes, provider outages, agent disagreement, event windows and invalid risk plans.
8. Run chronological backtests, walk-forward tests and a final untouched holdout for each market. Include spread, fees and slippage.
9. Paper trade and measure signal frequency, fill assumptions, win rate, expectancy, profit factor, maximum drawdown and rejection reasons.
10. Only after validation, consider enabling broker execution with explicit account/venue configuration and user approval.

## 8. Acceptance criteria

- A candidate is never lost merely because an LLM/agent timed out.
- Missing mandatory data cannot pass silently.
- Every rejected candidate has machine-readable blockers.
- Every approved paper signal has a fresh bid/ask, entry, SL, TP, position size and risk/reward.
- No signal is marked executable without a connected execution venue.
- EUR/USD, BTC/USD and XAU/USD use isolated, tested profiles.
- Tests prove the score cannot override hard risk gates.
- Backtest results are reported separately per market and include costs and out-of-sample results.

## 9. Reporting format

For each instrument, publish:

1. Candidate: BUY / SELL / NO SETUP.
2. Score: X/100 and coverage percentage.
3. Verification: PASS / WATCH / REJECT.
4. Entry plan: bid, ask, entry, SL, TP, R:R and position size, or explicit unavailable reasons.
5. Execution: PAPER APPROVED / BLOCKED / BROKER EXECUTABLE.
6. Blockers: exact list, not a generic HOLD message.

## 10. Non-goals

- Do not force a trade to avoid HOLD.
- Do not lower thresholds solely to increase signal count.
- Do not treat candle-derived order-flow proxies as exchange-wide order-book depth or executed buyer/seller volume.
- Do not claim backtested accuracy without reproducible data and costs.
- Do not place broker orders as part of this proposal.

**Decision requested:** implement this proposal incrementally in the existing engine, validate each market independently, and merge only after test and review results are visible.
