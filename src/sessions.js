// Session context for EUR/USD and BTC/USD.
// Independent implementation of session timing/range statistics; no LuxAlgo source code is included.
// Times are interpreted in a fixed UTC offset (default UTC). Set SESSION_UTC_OFFSET to adjust.
const SESSION_DEFS = [
  { id: "london", name: "London", start: 7 * 60, end: 16 * 60 },
  { id: "newYork", name: "New York", start: 13 * 60, end: 22 * 60 },
  { id: "tokyo", name: "Tokyo", start: 0, end: 9 * 60 },
  { id: "sydney", name: "Sydney", start: 21 * 60, end: 6 * 60 }
];

function isActive(minute, start, end) {
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

export function getSessionContext(candles, options = {}) {
  if (!Array.isArray(candles) || candles.length === 0) {
    return { active: [], primary: "OFF_SESSION", utcOffset: 0, rangeHigh: null, rangeLow: null, rangePosition: null, breakout: "NONE" };
  }
  const offset = Number.isFinite(options.utcOffset) ? options.utcOffset : 0;
  const last = candles.at(-1);
  const timestamp = Number(last.timestamp ?? last.time);
  if (!Number.isFinite(timestamp)) {
    return { active: [], primary: "OFF_SESSION", utcOffset: offset, rangeHigh: null, rangeLow: null, rangePosition: null, breakout: "NONE" };
  }
  const local = new Date(timestamp + offset * 60_000);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const active = SESSION_DEFS.filter(s => isActive(minute, s.start, s.end));
  const ranges = active.map(session => {
    const localStart = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
    let startMinute = session.start;
    if (session.start > session.end && minute < session.end) localStart.setUTCDate(localStart.getUTCDate() - 1);
    const startUtc = localStart.getTime() + startMinute * 60_000 - offset * 60_000;
    const bars = candles.filter(c => Number(c.timestamp ?? c.time) >= startUtc && Number(c.timestamp ?? c.time) <= timestamp);
    if (!bars.length) return null;
    return {
      id: session.id, name: session.name,
      high: Math.max(...bars.map(c => Number(c.high))),
      low: Math.min(...bars.map(c => Number(c.low))),
      bars: bars.length
    };
  }).filter(Boolean);
  const rangeHigh = ranges.length ? Math.max(...ranges.map(r => r.high)) : null;
  const rangeLow = ranges.length ? Math.min(...ranges.map(r => r.low)) : null;
  const close = Number(last.close);
  const rangePosition = Number.isFinite(rangeHigh - rangeLow) && rangeHigh > rangeLow
    ? (close - rangeLow) / (rangeHigh - rangeLow) : null;
  const names = active.map(s => s.name);
  const primary = names.includes("London") && names.includes("New York") ? "LONDON_NEW_YORK_OVERLAP"
    : names.includes("London") ? "LONDON" : names.includes("New York") ? "NEW_YORK"
    : names.includes("Tokyo") ? "TOKYO" : names.includes("Sydney") ? "SYDNEY" : "OFF_SESSION";
  return {
    active: names, primary, utcOffset: offset, rangeHigh, rangeLow, rangePosition,
    breakout: "NONE", sessionRanges: ranges,
    isMajorSession: names.includes("London") || names.includes("New York")
  };
}

export function sessionDirectionalBonus(context, direction) {
  if (!context?.isMajorSession) return 0;
  return direction === "BUY" || direction === "SELL" ? 1 : 0;
}
