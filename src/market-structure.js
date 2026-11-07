function getTime(candle) {
  const value = candle.timestamp ?? candle.time ?? candle.date;
  if (value == null) return null;
  let time = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(time)) return null;
  if (time < 1e12) time *= 1000;
  return time;
}

function findSwings(candles, strength) {
  const swings = [];
  for (let i = strength; i < candles.length - strength; i++) {
    const high = Number(candles[i].high);
    const low = Number(candles[i].low);
    const neighbours = [...candles.slice(i - strength, i), ...candles.slice(i + 1, i + strength + 1)];
    if (neighbours.every(c => high > Number(c.high))) swings.push({ type: "HIGH", price: high, index: i });
    if (neighbours.every(c => low < Number(c.low))) swings.push({ type: "LOW", price: low, index: i });
  }
  return swings;
}

function findRecentBreak(candles, swing, direction, lookback) {
  if (!swing) return null;
  const start = Math.max(swing.index + 1, candles.length - lookback);
  for (let i = candles.length - 1; i >= start; i--) {
    const previousClose = Number(candles[i - 1].close);
    const currentClose = Number(candles[i].close);
    const crossed = direction === "BULLISH"
      ? previousClose <= swing.price && currentClose > swing.price
      : previousClose >= swing.price && currentClose < swing.price;
    if (crossed) return { direction, level: swing.price, index: i, barsAgo: candles.length - 1 - i };
  }
  return null;
}

function findRecentSweep(candles, swingHigh, swingLow, lookback) {
  const events = [];
  const start = Math.max(0, candles.length - lookback);
  for (let i = start; i < candles.length; i++) {
    const candle = candles[i];
    const high = Number(candle.high), low = Number(candle.low), close = Number(candle.close);
    if (swingHigh && i > swingHigh.index && high > swingHigh.price && close < swingHigh.price) {
      events.push({ direction: "BEARISH", level: swingHigh.price, sweepHigh: high, sweepLow: low, index: i, barsAgo: candles.length - 1 - i });
    }
    if (swingLow && i > swingLow.index && low < swingLow.price && close > swingLow.price) {
      events.push({ direction: "BULLISH", level: swingLow.price, sweepHigh: high, sweepLow: low, index: i, barsAgo: candles.length - 1 - i });
    }
  }
  if (!events.length) return null;
  events.sort((a, b) => b.index - a.index);
  if (events.length > 1 && events[0].index === events[1].index && events[0].direction !== events[1].direction) return null;
  const event = events[0];
  let confirmed = false, confirmationBarsAgo = null;
  for (let i = event.index + 1; i < candles.length; i++) {
    const close = Number(candles[i].close);
    const confirmation = event.direction === "BULLISH" ? close > event.sweepHigh : close < event.sweepLow;
    if (confirmation) { confirmed = true; confirmationBarsAgo = candles.length - 1 - i; break; }
  }
  return { ...event, confirmed, confirmationBarsAgo };
}

export function analyzeMarketStructure(candles, strength = 3) {
  if (!Array.isArray(candles) || candles.length < strength * 2 + 10) throw new Error("Not enough candles for market structure");
  for (const candle of candles) {
    const high = Number(candle.high), low = Number(candle.low), close = Number(candle.close);
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close) || high < low) throw new Error("Invalid OHLC candle data");
  }
  const swings = findSwings(candles, strength);
  const latestHigh = [...swings].reverse().find(swing => swing.type === "HIGH");
  const latestLow = [...swings].reverse().find(swing => swing.type === "LOW");
  const bullishBreak = findRecentBreak(candles, latestHigh, "BULLISH", 6);
  const bearishBreak = findRecentBreak(candles, latestLow, "BEARISH", 6);
  let breakEvent = null;
  if (bullishBreak && bearishBreak) {
    if (bullishBreak.index > bearishBreak.index) breakEvent = bullishBreak;
    else if (bearishBreak.index > bullishBreak.index) breakEvent = bearishBreak;
  } else breakEvent = bullishBreak || bearishBreak;
  const sweepEvent = findRecentSweep(candles, latestHigh, latestLow, 3);
  const latestTime = getTime(candles[candles.length - 1]);
  let previousDayHigh = null, previousDayLow = null;
  if (latestTime !== null) {
    const previousDay = new Date(latestTime - 86400000).toISOString().slice(0, 10);
    const dayCandles = candles.filter(candle => {
      const time = getTime(candle);
      return time !== null && new Date(time).toISOString().slice(0, 10) === previousDay;
    });
    if (dayCandles.length) {
      previousDayHigh = Math.max(...dayCandles.map(c => Number(c.high)));
      previousDayLow = Math.min(...dayCandles.map(c => Number(c.low)));
    }
  }
  return {
    swingHigh: latestHigh?.price ?? null,
    swingLow: latestLow?.price ?? null,
    swingHighBarsAgo: latestHigh ? candles.length - 1 - latestHigh.index : null,
    swingLowBarsAgo: latestLow ? candles.length - 1 - latestLow.index : null,
    bos: breakEvent?.direction ?? "NONE",
    bosLevel: breakEvent?.level ?? null,
    bosBarsAgo: breakEvent?.barsAgo ?? null,
    liquiditySweep: sweepEvent?.direction ?? "NONE",
    liquiditySweepLevel: sweepEvent?.level ?? null,
    liquiditySweepBarsAgo: sweepEvent?.barsAgo ?? null,
    sweepConfirmed: sweepEvent?.confirmed ?? false,
    sweepConfirmationBarsAgo: sweepEvent?.confirmationBarsAgo ?? null,
    previousDayHigh, previousDayLow
  };
}
