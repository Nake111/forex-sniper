# BTC spot/futures order-flow feed contract

**Mode: PAPER / RESEARCH ONLY.** This feed is read-only. It must never place orders or override the existing quote, news, risk, approval, or holdout gates.

Set `BTC_ORDER_FLOW_FEED_URL` to an HTTPS endpoint that returns one JSON snapshot in this shape:

```json
{
  "symbol": "BTC-USD",
  "source": "Provider and venue name",
  "timestamp": 1795860000000,
  "spot": {
    "buyVolume": 12.5,
    "sellVolume": 8.2,
    "cvd": 4.3
  },
  "perpetual": {
    "buyVolume": 31.0,
    "sellVolume": 26.0,
    "cvd": 5.0,
    "openInterestChangePct": 0.35,
    "fundingRate": 0.0001
  }
}
```

Requirements:

- `timestamp` is the provider's Unix timestamp in milliseconds, not the local fetch time.
- Snapshot age must be no more than 30 seconds; future timestamps beyond 2 seconds are rejected.
- Spot and perpetual buy/sell volumes must be non-negative and both CVD values must be finite.
- Open-interest change is a percentage change for the same provider-defined observation interval.
- Funding rate must be a decimal rate, not a percent string (for example, 0.0001 means 0.01%).
- Provider/source identity must be explicit. Do not mix venues or silently substitute another market.
- CVD sign convention must be positive for net aggressive buying and negative for net aggressive selling.
- If any required field is missing, stale, or invalid, the feed is reported as unavailable and BTC approval fails closed.

The BTC gate requires spot CVD and perpetual CVD to agree with the candidate direction, positive open-interest change, non-crowded funding, and the other independent BTC checks. These are confirmation conditions, not a forecast or a guarantee of profitability.

The default maximum absolute funding rate is 0.001 per provider funding interval. This is a conservative configurable research threshold, not a universal market standard. The maximum quote-to-last-closed-M5 distance is 0.75 M5 ATR and maximum spread is 0.18 M5 ATR.

No provider endpoint is bundled or invented. Until a real, timestamped feed is configured, the order-flow gate remains unavailable and BTC signals remain unapproved.
