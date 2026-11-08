// Session context for EUR/USD and BTC/USD.
// Independent implementation of common session timing/range statistics; no LuxAlgo source code is included.
// Times use a fixed UTC offset (default UTC). Set SESSION_UTC_OFFSET to shift the session clock.
const SESSION_DEFS = [
  { id: "london", name: "London", start: 7 * 60, end: 16 * 60 },
  { id: "newYork", name: "New York", start: 13 * 60, end: 22 * 60 },
  { id: "tokyo", name: "Tokyo", start: 0, end: 9 * 60 },
  { id: "sydney", name: "Sydney", start: 21 * 60, end: 6 * 60 }
];

function isActive(minute, start, end) {
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

function emptyContext(utcOffset = 0) {
  return {
    active: [], primary: "OFF_SESSION", utcOffset,
    rangeHigh: null, rangeLow: null, rangePosition: null,
    breakout: "NONE", sessionRanges: [], isMajorSession: false
  };
}

function candleTime(candle) {
  const value = Number(candle.timestamp ?? candle.time);
  if (!Number.isFinite(value)) return NaN;
  return value < 1e12 ? value * 1000 : value;
}

export function getSessionContext(candles, options = {}) {
  const offsetHours = Number.isFinite(options.utcOffset) ? options.utcOffset : 0;
  const offsetMs = offsetHours * 60 * 60_000;
  if (!Array.isArray(candles) || candles.length === 0) return emptyContext(offsetHours);

  const last = candles.at(-1);
  const timestamp = candleTime(last);
  if (!Number.isFinite(timestamp)) return emptyContext(offset);

  const local = new Date(timestamp + offsetMs);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const active = SESSION_DEFS.filter(session => isActive(minute, session.start, session.end));
  if (!active.length) return emptyContext(offset);

  const ranges = active.map(session => {
    const localStart = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
    if (session.start > session.end && minute < session.end) localStart.setUTCDate(localStart.getUTCDate() - 1);
    const startUtc = localStart.getTime() + session.start * 60_000 - offsetMs;
    const sessionBars = candles.filter(candle => {
      const time = candleTime(candle);
      return Number.isFinite(time) && time >= startUtc && time <= timestamp;
    });
    const previousBars = sessionBars.filter(candle => candleTime(candle) < timestamp);
    const validBars = sessionBars.filter(candle =>
      Number.isFinite(Number(candle.high)) && Number.isFinite(Number(candle.low))
    );
    if (!validBars.length) return null;
    return {
      id: session.id,
      name: session.name,
      high: Math.max(...validBars.map(candle => Number(candle.high))),
      low: Math.min(...validBars.map(candle => Number(candle.low))),
      previousHigh: previousBars.length ? Math.max(...previousBars.map(candle => Number(candle.high))) : null,
      previousLow: previousBars.length ? Math.min(...previousBars.map(candle => Number(candle.low))) : null,
      bars: validBars.length
    };
  }).filter(Boolean);

  const rangeHigh = ranges.length ? Math.max(...ranges.map(range => range.high)) : null;
  const rangeLow = ranges.length ? Math.min(...ranges.map(range => range.low)) : null;
  const close = Number(last.close);
  const rangePosition = Number.isFinite(close) && Number.isFinite(rangeHigh) &&
    Number.isFinite(rangeLow) && rangeHigh > rangeLow
    ? (close - rangeLow) / (rangeHigh - rangeLow) : null;

  // Compare the latest close with the range formed by earlier candles in the active session.
  // This avoids including the current candle in the breakout threshold.
  const priorHighs = ranges.map(range => range.previousHigh).filter(Number.isFinite);
  const priorLows = ranges.map(range => range.previousLow).filter(Number.isFinite);
  const priorHigh = priorHighs.length ? Math.max(...priorHighs) : null;
  const priorLow = priorLows.length ? Math.min(...priorLows) : null;
  const breakout = Number.isFinite(close) && priorHigh !== null && close > priorHigh ? "BULLISH"
    : Number.isFinite(close) && priorLow !== null && close < priorLow ? "BEARISH" : "NONE";

  const names = active.map(session => session.name);
  const primary = names.includes("London") && names.includes("New York") ? "LONDON_NEW_YORK_OVERLAP"
    : names.includes("London") ? "LONDON"
    : names.includes("New York") ? "NEW_YORK"
    : names.includes("Tokyo") ? "TOKYO"
    : names.includes("Sydney") ? "SYDNEY" : "OFF_SESSION";

  return {
    active: names,
    primary,
    utcOffset: offsetHours,
    rangeHigh,
    rangeLow,
    rangePosition,
    breakout,
    sessionRanges: ranges,
    isMajorSession: names.includes("London") || names.includes("New York")
  };
}
