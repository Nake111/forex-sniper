# Phase 2 — Agent Accountability & Chief Consensus

## What it measures

The append-only Second Brain journal already records `AGENT_FORECAST` observations and later `AGENT_FORECAST_OUTCOME` resolutions. Phase 2 turns those records into transparent diagnostics:

- Per-agent forecast count, resolved count, accuracy and pending count.
- Market and regime breakdowns for each agent.
- Chief directional consensus per market/candle, buy/sell split, agreement percentage, realized direction and disagreement count.
- Dashboard tables on the existing Strategy Performance page.

## Qualification and safeguards

- An agent needs 30 resolved forecasts before the dashboard says its sample threshold is met. This is not proof of edge.
- All agent weights remain exactly zero; no adaptive weighting is activated.
- Chief consensus has no approval authority and cannot modify BUY/SELL decisions or risk gates.
- Correlated agents are not treated as independent votes.
- No backtest holdout is read or used.
- Only resolved forward-paper observations are evaluated; unresolved forecasts remain pending.
- No broker connection, live order, automatic stop movement or execution capability is added.

## Data limitations

Directional accuracy is a forecast diagnostic, not a trading win rate or profitability measure. The actual direction comes from the existing 12-closed-M5-bar forecast resolution rule. It does not represent executable fills. Paper-trade win rate, net estimated R and profit factor remain separately calculated by the existing paper-performance engine.

## Validation

`npm run check` and `npm test` validate syntax and regression behavior. The Phase 2 tests cover segmented scorecards, disagreement reporting, insufficient sample handling and zero authority.
