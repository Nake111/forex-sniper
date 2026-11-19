# Eight-Agent Quant Desk (Research Only)

The Quant Desk adapts the role-separated workflow shown in the supplied reference to Forex Sniper's supported markets: EUR/USD, BTC/USD and XAU/USD.

## Roles

| Role | Forex Sniper responsibility |
|---|---|
| Scout | Surfaces the existing directional candidate and evidence score for review. |
| Auditor | Reports quote validity, spread validation, candle freshness and macro/news pre-checks. |
| Trigger | Reports whether the existing closed-M5 entry-trigger flag is confirmed. |
| Tracker | Displays available buyer/seller or positioning proxies, with explicit data limitations. It does not invent FX smart-wallet or consolidated order-flow data. |
| Warden | Highlights spread, stale-data and macro/news risk warnings. Existing hard gates remain authoritative. |
| Trail | Observes the existing paper entry/SL/TP plan for research. It does not modify stops or manage live positions. |
| Pulse | Summarizes available headline/event context. Social mention velocity and sentiment remain unavailable unless a validated feed is added. |
| Chief | Coordinates the seven specialist reports and hands off to the existing independent approval chain. It has no approval authority. |

The user remains the final manual decision-maker. The Chief is the eighth automated role; the user is not counted as an agent.

## Safety and evaluation

- `signalWeight: 0`; all roles are diagnostics only.
- The desk cannot promote a candidate, approve a trade, change entry/SL/TP, or place orders.
- Existing quote, spread, calendar, M5 trigger, independent approval, entry verification, out-of-sample and risk gates remain unchanged.
- No crypto-token-specific checks (mint authority, honeypot, LP lock, smart-wallet buys) are copied into FX. They are replaced with relevant market-data and risk diagnostics.
- Desk output is attached to the existing Second Brain journal for later review.
- Keep this adapter at zero weight until independently evaluated on chronological training data, then frozen and tested once on the untouched holdout. Do not infer profitability from the Threads post's reported results.

## Validation

Run:

```bash
npm run check
npm test
```
