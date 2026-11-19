# Phase 4 — Trade Excursion & Entry-Quality Diagnostics

Phase 4 adds post-resolution diagnostics to the append-only paper journal. It does not change signal discovery, entry/stop/target levels, approval gates, agent weights, strategy thresholds, or execution.

## New measurements

For each resolved paper signal, calculate:

- **MFE (maximum favourable excursion):** the greatest favourable price movement from the indicative entry before resolution, expressed in initial-risk units (R).
- **MAE (maximum adverse excursion):** the greatest adverse price movement from the indicative entry before resolution, expressed as a positive magnitude in R.
- Excursion price distances, number of closed M5 bars observed, and an explicit coverage flag.

The path includes closed M5 candles after the signal candle through the resolution candle. BUY and SELL excursions use opposite high/low directions. The resolution candle is included even when stop and target both touch; the outcome remains AMBIGUOUS and is not converted into a win or loss.

## Interpretation

MFE/MAE are OHLC range estimates, not tick-by-tick paths. They cannot establish which extreme occurred first inside a candle, do not represent executable fills, and do not measure actual slippage. They are descriptive diagnostics for reviewing whether entries experienced favourable movement, adverse heat, or late/poor positioning.

Dashboard averages include only records with valid excursion coverage. Missing history or invalid entry/risk produces null values and is not silently treated as zero. Legacy outcomes without excursion fields remain valid and are excluded from excursion averages.

## Safeguards

- PAPER_RESEARCH_ONLY; no broker connection or order placement.
- No signal-weight, approval, stop/target, or strategy threshold changes.
- No adaptive tuning from these metrics.
- Chronological training remains limited to the first 70%; final 30% holdout remains untouched and reserved for one evaluation after candidate settings are frozen.
- The 30-resolved-trade minimum remains a sample warning, not proof of edge.
