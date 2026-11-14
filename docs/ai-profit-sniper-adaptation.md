# AI Profit Sniper concepts — Forex Sniper adaptation

The upstream repository `michaelxu688/ai-trading-signals-engine` currently contains a README only; it does not publish an installable engine, source package, dependency manifest, or license. Forex Sniper therefore does not install or execute its code.

This adaptation uses the public README's research concepts:
- multi-factor market scanning,
- volatility compression and release,
- range breakout detection,
- volume surge confirmation,
- structured research annotations.

## Implementation

`src/market-surveillance.js` compares the latest closed candle with the preceding 20-candle range. A breakout is only marked as a confirmed candidate when it is accompanied by volatility expansion (ATR expansion or squeeze release) and reported candle volume at least 1.5 times its prior 20-candle average.

When volume history is unavailable, the scanner explicitly reports that limitation rather than inferring a surge. For spot FX, reported candle volume can represent tick volume, not centralized traded volume.

The result is attached to each timeframe analysis and printed in the analysis report. It has zero score weight, cannot change BUY/SELL direction, cannot approve a signal, and cannot bypass any existing quote, spread, entry, risk/reward or independent approval gate.

## Validation

Regression tests cover bullish breakout confirmation, missing volume, insufficient data, and non-breakout candles. These are software behavior tests, not evidence of profitability.

Any future change that gives this scanner signal weight must first be evaluated on the chronological training segment. Freeze candidate settings before evaluating the preserved final 30% holdout.
