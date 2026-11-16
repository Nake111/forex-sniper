const finite = value => Number.isFinite(Number(value));

export function assessCandleVolume(candles = []) {
  const rows = Array.isArray(candles) ? candles : [];
  const reported = rows.filter(candle => finite(candle?.volume) && Number(candle.volume) > 0).length;
  const zeroOrMissing = rows.length - reported;
  const coveragePct = rows.length ? reported / rows.length * 100 : 0;
  return {
    status: reported === 0 ? "UNAVAILABLE" : zeroOrMissing ? "PARTIAL" : "REPORTED",
    candleCount: rows.length,
    candlesWithPositiveVolume: reported,
    candlesWithoutPositiveVolume: zeroOrMissing,
    coveragePct: Number(coveragePct.toFixed(2)),
    usableForVolumeProfile: rows.length > 0 && reported === rows.length
  };
}

/**
 * Compares the live quote midpoint with the latest closed candle close.
 * This is a diagnostic, not a substitute for the executable-side entry-drift
 * gate. Different data venues are explicitly reported, never silently merged.
 */
export function assessQuoteCandleBasis({ quote, candle, atr }) {
  const midpoint = quote && finite(quote.bid) && finite(quote.ask)
    ? (Number(quote.bid) + Number(quote.ask)) / 2 : null;
  const close = finite(candle?.close) ? Number(candle.close) : null;
  const atrValue = finite(atr) && Number(atr) > 0 ? Number(atr) : null;
  const difference = midpoint !== null && close !== null ? midpoint - close : null;
  const differenceAtr = difference !== null && atrValue !== null
    ? Math.abs(difference) / atrValue : null;
  const quoteVenue = quote?.venue ?? null;
  const candleSource = candle?.source ?? null;
  return {
    status: differenceAtr === null ? "UNAVAILABLE"
      : differenceAtr > 0.2 ? "DIVERGENCE_REVIEW" : "WITHIN_REVIEW_BAND",
    quoteVenue,
    quoteSource: quote?.source ?? null,
    candleSource,
    sourceLabelsDiffer: Boolean(quoteVenue && candleSource && quoteVenue !== candleSource),
    quoteMidpoint: midpoint,
    latestClosedCandleClose: close,
    difference,
    differenceAtr: differenceAtr === null ? null : Number(differenceAtr.toFixed(4)),
    diagnosticOnly: true,
    note: "Compare venue/source labels and price basis. Existing executable-side entry-drift and quote validation gates remain authoritative."
  };
}
