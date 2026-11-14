# Pocket Option Bot PRO strategy concepts — Forex Sniper adaptation

This is an independent, paper/research-only adaptation of selected public strategy descriptions from tradervitaly/pocket-option-bot-pro. It is not a copy of the extension and does not connect to Pocket Option.

## Adapted concepts
- Classic Stochastic (14, 3): %K from closed OHLC candles and %D smoothing.
- Candle Streak reversal: at least three consecutive same-direction candles, followed by an opposite candle closing in the top/bottom 30% of its range.
- RSI wick rejection: an upper wick of at least 30% of candle range with RSI >= 70 is bearish evidence; a lower wick of at least 30% with RSI <= 30 is bullish evidence.
- Multi-indicator confluence: M5 RSI, MACD histogram, classic Stochastic and Candle Streak must align in at least 3 of 4 available votes. A confirmed opposing RSI wick rejection vetoes these confluence points.

## Signal integration
The confluence is a 10-point candidate-strength component in `src/weighted-score.js`. The score is still only a heuristic candidate filter. It cannot approve a BUY/SELL, create an executable order, or override the independent quote, closed-candle trigger, macro, stop/target, minimum 1:2 effective reward/risk or approval gates.

## Deliberately excluded
- Pocket Option browser extension, DOM automation, account login, cookies or unofficial platform API.
- Binary-options CALL/PUT execution and short expiry assumptions.
- Martingale, inverse Martingale, recovery staking or increasing position size after a loss.
- Automatic trade opening or any broker integration.

The Forex Sniper remains paper/research-only. These indicator rules are a testable hypothesis, not evidence of improved profitability. Any strategy change must be evaluated on the training segment first and the preserved final 30% holdout only after the candidate settings are frozen.
