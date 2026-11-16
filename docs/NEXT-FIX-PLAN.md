# Forex Sniper — Next Fix Plan

**Status:** Saved implementation backlog; not a claim that these fixes are complete.  
**Repository:** `Nake111/forex-sniper`  
**Branch:** `main`  
**Operating mode:** PAPER / RESEARCH ONLY. No broker integration or live orders.

## Safety invariants

- Keep the final 30% chronological holdout untouched. Do not read its outcomes, optimize against it, or use it for calibration until candidate settings are frozen and the one-time holdout protocol is explicitly authorized.
- Keep all decisions fail-closed: missing, stale, mismatched, or unverified evidence means `NO APPROVED TRADE`.
- Use closed candles only for signal confirmation.
- Preserve provider timestamp, local receive timestamp, source, venue, bid, ask, and quote snapshot identity together.
- No BUY/SELL publication unless all independent approvals, quote/entry checks, and risk gates pass.

## Ordered work

### 1. Complete and verify the training-cutoff variable freeze

**Observed state:** `config/approved-training-cutoff.json` records an approved cutoff of `2026-09-21T07:25:00.000Z`, holdout start `2026-09-21T07:30:00.000Z`, and `holdoutRead: false`. Its status is still `APPROVED_TO_FREEZE`. The freeze workflow explicitly reports `VERIFIED_AWAITING_REPOSITORY_VARIABLE` when it cannot write the repository variable.

**Actions:**
- Configure repository Actions variable `AGENT_TRAINING_CUTOFF=2026-09-21T07:25:00.000Z` through GitHub repository Settings, or provide the workflow's narrowly scoped `TRAINING_CUTOFF_ADMIN_TOKEN` secret with Actions variables read/write access.
- Run `Freeze Approved Training Cutoff`.
- Require a successful workflow and read-back equality for the variable.
- Verify the generated `frozen-training-cutoff` artifact says `FROZEN`, `variableVerified: true`, and `holdoutRead: false`.
- Remove any silent fallback from production signal workflows after the repository variable is verified; a missing variable must fail closed rather than silently substituting a value.

**Acceptance:** Variable read-back equals the approved timestamp; freeze artifact is verified; holdout remains locked.

### 2. Fix EUR/USD spread and M5 confirmation

**Observed blockers:** Latest published EUR/USD candidate was SELL, but independent consensus was only 2/5. The report also listed unverified spread/ATR, stale or invalid quote evidence, and missing closed-M5 confirmation.

**Actions:**
- Trace the exact EUR/USD quote snapshot from provider response through validation, entry verification, and publication. Keep bid/ask, provider timestamp, receive timestamp, source, venue, and snapshot ID from the same immutable quote.
- Calculate spread as `ask - bid` and normalize against the latest valid closed M5 ATR in the same price units. Reject missing, non-finite, non-positive, stale, crossed, or mismatched inputs.
- Record the measured spread, ATR, spread/ATR ratio, configured limit, and quote age in the report.
- Ensure the M5 trigger is evaluated from the latest fully closed M5 candle, not the forming candle or an older candle. Record candle timestamp and the exact confirmation rule/result.
- Add regression tests for missing ATR, unit mismatch, stale quote, changed snapshot, spread above limit, forming candle, and valid closed-candle confirmation.

**Acceptance:** Every EUR/USD candidate has auditable spread/ATR and closed-M5 evidence; otherwise it remains blocked.

### 3. Resolve BTC/USD squeeze-release and entry-chasing rejection

**Observed blockers:** Latest BTC/USD candidate had 3/5 directional BUY votes, but H1 squeeze release was not confirmed, H1 regime/EMA disagreed, and executable price was 0.259 ATR from reference entry versus a 0.25 ATR maximum.

**Actions:**
- Define squeeze release using a fully closed H1 candle and persist squeeze state, release timestamp, momentum direction, and volatility expansion evidence.
- Require H1 trend/regime alignment with the release direction; no inference from an intrabar move.
- Recalculate executable-side price (ask for BUY, bid for SELL) from a fresh provider-timestamped quote immediately before approval.
- If deviation exceeds the configured threshold, expire the candidate. Do not widen the threshold to force a trade; wait for a new setup and new closed-candle confirmation.
- Add tests for active squeeze, false/intrabar release, H1 trend conflict, quote movement just inside/outside the threshold, and expired candidate.

**Acceptance:** BTC/USD only advances after a closed-H1 release, aligned regime, and in-range fresh executable quote.

### 4. Strengthen independent approval

**Observed blockers:** A five-agent directional quorum can pass while independent approval and market-intelligence review still reject the candidate. The approval chain must preserve distinct responsibilities and evidence.

**Actions:**
- Document and enforce five distinct roles: market structure/setup, momentum/regime, liquidity/volatility, macro/news risk, and independent risk/entry verification.
- Ensure each agent records its own direction, evidence timestamps, source inputs, confidence/reliability, and explicit abstention reason.
- Prevent an agent from copying another agent's decision or treating the shared candidate direction as independent evidence.
- Keep directional quorum separate from final trade approval. Require independent signal approval, independent market-intelligence confirmation, entry verification, quote validation, and risk gates.
- Record disagreements and missing agent responses; fail closed on missing, stale, or correlated evidence.
- Add tests for duplicated agent outputs, stale evidence, conflicting directions, missing agents, quorum pass with final approval failure, and unanimous but invalid quote/risk evidence.

**Acceptance:** All five roles execute distinctly and their evidence is auditable; no agent quorum can override final risk gates.

### 5. Build a minimum forward-paper sample before performance approval

**Observed state:** Latest paper journal counts were EUR/USD 1/30, BTC/USD 2/30, and XAU/USD 0/30 resolved trades. Performance gates also reported non-positive net expectancy and profit factor below 1.1.

**Actions:**
- Continue append-only paper tracking; never fabricate, backfill, or selectively omit trades.
- Record signal time, market, direction, strategy/profile version, quote snapshot, executable-side entry, spread, estimated commission/slippage, stop, target, exit, outcome, and reason for closure.
- Count only fully resolved, non-duplicate paper trades with complete cost and quote evidence.
- Require at least 30 resolved trades per market/profile before considering that market/profile for performance approval.
- Evaluate net expectancy after spread/commission/slippage, profit factor (minimum 1.1), drawdown, win/loss distribution, and session/regime breakdown. Keep all thresholds fixed before evaluation.
- Continue to report `NOT_APPROVED` until the sample and all performance gates pass. Thirty trades are a minimum screening sample, not proof of profitability.

**Acceptance:** Each market/profile has at least 30 independently auditable resolved forward-paper trades and passes all predeclared net-performance and risk gates.

## Execution order

1. Freeze and verify `AGENT_TRAINING_CUTOFF`.
2. Fix EUR/USD quote-to-ATR and closed-M5 evidence.
3. Fix BTC/USD closed-H1 squeeze release and entry expiry.
4. Strengthen five-agent independence and final approval.
5. Accumulate and evaluate forward-paper samples without touching the holdout.

## Current completion status

All five items are **OPEN**. This file records the agreed work and acceptance criteria only. No source-code fix, repository variable change, new workflow run, trade approval, or holdout access is implied by saving this plan.
