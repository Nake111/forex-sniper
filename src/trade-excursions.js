const finite = Number.isFinite;
const round = (value, digits = 4) => finite(value) ? Number(value.toFixed(digits)) : null;

/**
 * Measures the largest favourable and adverse price excursions from the
 * indicative entry, in initial-risk units. Candles are closed M5 bars and
 * include the resolution bar. Intrabar ordering is unknowable.
 */
export function calculateTradeExcursions({ candles = [], side, entry, stop }) {
  if (!Array.isArray(candles) || !["BUY", "SELL"].includes(side) ||
      !finite(entry) || !finite(stop)) {
    return {
      maxFavorableExcursionR: null, maxAdverseExcursionR: null,
      maxFavorableExcursionPrice: null, maxAdverseExcursionPrice: null,
      excursionBars: 0, excursionCoverage: false,
      excursionMethod: "Unavailable: missing valid side, entry, stop or candle path"
    };
  }
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) {
    return {
      maxFavorableExcursionR: null, maxAdverseExcursionR: null,
      maxFavorableExcursionPrice: null, maxAdverseExcursionPrice: null,
      excursionBars: 0, excursionCoverage: false,
      excursionMethod: "Unavailable: zero or invalid initial risk"
    };
  }
  const valid = candles.filter(c => {
    const high = Number(c?.high), low = Number(c?.low);
    return finite(high) && finite(low) && high >= low;
  });
  if (!valid.length) {
    return {
      maxFavorableExcursionR: null, maxAdverseExcursionR: null,
      maxFavorableExcursionPrice: null, maxAdverseExcursionPrice: null,
      excursionBars: 0, excursionCoverage: false,
      excursionMethod: "Unavailable: no valid closed candles in trade path"
    };
  }
  let favourable = 0, adverse = 0;
  for (const candle of valid) {
    const high = Number(candle.high), low = Number(candle.low);
    favourable = Math.max(favourable, side === "BUY" ? high - entry : entry - low);
    adverse = Math.max(adverse, side === "BUY" ? entry - low : high - entry);
  }
  return {
    maxFavorableExcursionR: round(favourable / risk),
    maxAdverseExcursionR: round(adverse / risk),
    maxFavorableExcursionPrice: round(favourable, 8),
    maxAdverseExcursionPrice: round(adverse, 8),
    excursionBars: valid.length,
    excursionCoverage: true,
    excursionMethod: "Closed M5 candle high/low extremes from indicative entry through resolution candle; intrabar ordering and actual fills are unknown"
  };
}
