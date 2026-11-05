
// Independent Smart Money Concepts engine for Forex Sniper.
// Conceptual reference: LuxAlgo Smart Money Concepts, © LuxAlgo.
// Reference license: CC BY-NC-SA 4.0
// https://creativecommons.org/licenses/by-nc-sa/4.0/
// This is an independent JavaScript implementation, not copied Pine Script.

function n(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function findPivots(candles, strength) {
  const highs = [];
  const lows = [];

  for (let i = strength; i < candles.length - strength; i++) {
    const high = n(candles[i].high);
    const low = n(candles[i].low);

    let isHigh = high !== null;
    let isLow = low !== null;

    for (let j = i - strength; j <= i + strength; j++) {
      if (j === i) continue;

      if (high <= n(candles[j].high)) isHigh = false;
      if (low >= n(candles[j].low)) isLow = false;
    }

    if (isHigh) highs.push({ price: high, index: i });
    if (isLow) lows.push({ price: low, index: i });
  }

  return { highs, lows };
}

function findStructureEvents(candles, pivots, direction) {
  const events = [];

  for (const pivot of pivots) {
    for (let i = pivot.index + 1; i < candles.length; i++) {
      const previous = n(candles[i - 1].close);
      const close = n(candles[i].close);

      const crossed = direction === "BULLISH"
        ? previous <= pivot.price && close > pivot.price
        : previous >= pivot.price && close < pivot.price;

      if (crossed) {
        events.push({
          direction,
          level: pivot.price,
          index: i,
          barsAgo: candles.length - 1 - i
        });
        break;
      }
    }
  }

  events.sort((a, b) => a.index - b.index);

  let bias = 0;

  for (const event of events) {
    const nextBias = event.direction === "BULLISH" ? 1 : -1;

    event.type =
      bias !== 0 && bias !== nextBias ? "CHoCH" : "BOS";

    bias = nextBias;
  }

  return events;
}

function findOrderBlock(candles, event) {
  if (!event) return null;

  const bullish = event.direction === "BULLISH";
  const start = Math.max(0, event.index - 20);

  for (let i = event.index - 1; i >= start; i--) {
    const candle = candles[i];

    const open = n(candle.open);
    const close = n(candle.close);
    const high = n(candle.high);
    const low = n(candle.low);

    if ([open, close, high, low].some(v => v === null)) {
      continue;
    }

    const opposite = bullish
      ? close < open
      : close > open;

    if (!opposite) continue;

    return {
      direction: event.direction,
      high,
      low,
      barsAgo: candles.length - 1 - i,
      mitigated: bullish
        ? n(candles.at(-1).low) < low
        : n(candles.at(-1).high) > high
    };
  }

  return null;
}

function findFVGs(candles) {
  const gaps = [];
  const start = Math.max(2, candles.length - 50);

  for (let i = start; i < candles.length; i++) {
    const first = candles[i - 2];
    const current = candles[i];

    const firstHigh = n(first.high);
    const firstLow = n(first.low);
    const currentHigh = n(current.high);
    const currentLow = n(current.low);

    if (
      [firstHigh, firstLow, currentHigh, currentLow]
        .some(v => v === null)
    ) continue;

    if (currentLow > firstHigh) {
      gaps.push({
        direction: "BULLISH",
        top: currentLow,
        bottom: firstHigh,
        barsAgo: candles.length - 1 - i,
        filled: n(candles.at(-1).low) <= firstHigh
      });
    }

    if (currentHigh < firstLow) {
      gaps.push({
        direction: "BEARISH",
        top: firstLow,
        bottom: currentHigh,
        barsAgo: candles.length - 1 - i,
        filled: n(candles.at(-1).high) >= firstLow
      });
    }
  }

  return gaps
    .filter(gap => !gap.filled)
    .slice(-5)
    .reverse();
}

function findEqualLevels(pivots, tolerance) {
  for (let i = pivots.length - 1; i > 0; i--) {
    const a = pivots[i - 1];
    const b = pivots[i];

    if (Math.abs(a.price - b.price) <= tolerance) {
      return (a.price + b.price) / 2;
    }
  }

  return null;
}

export function analyzeSmartMoney(candles) {
  if (!Array.isArray(candles) || candles.length < 60) {
    throw new Error("Not enough candles for SMC analysis.");
  }

  const swing = findPivots(candles, 10);
  const internal = findPivots(candles, 3);

  const swingEvents = [
    ...findStructureEvents(candles, swing.highs, "BULLISH"),
    ...findStructureEvents(candles, swing.lows, "BEARISH")
  ].sort((a, b) => a.index - b.index);

  const internalEvents = [
    ...findStructureEvents(candles, internal.highs, "BULLISH"),
    ...findStructureEvents(candles, internal.lows, "BEARISH")
  ].sort((a, b) => a.index - b.index);

  const lastSwing = swingEvents.at(-1) ?? null;
  const lastInternal = internalEvents.at(-1) ?? null;

  const lastBullish = [...swingEvents]
    .reverse()
    .find(e => e.direction === "BULLISH");

  const lastBearish = [...swingEvents]
    .reverse()
    .find(e => e.direction === "BEARISH");

  const orderBlocks = [
    findOrderBlock(candles, lastBullish),
    findOrderBlock(candles, lastBearish)
  ].filter(Boolean);

  const current = n(candles.at(-1).close);

  const recent = candles.slice(-50);
  const rangeHigh = Math.max(...recent.map(c => n(c.high)));
  const rangeLow = Math.min(...recent.map(c => n(c.low)));
  const equilibrium = (rangeHigh + rangeLow) / 2;

  const recentRanges = candles.slice(-15).map(
    c => n(c.high) - n(c.low)
  );

  const averageRange =
    recentRanges.reduce((a, b) => a + b, 0) /
    recentRanges.length;

  return {
    swing: {
      direction: lastSwing?.direction ?? "NEUTRAL",
      type: lastSwing?.type ?? "NONE",
      level: lastSwing?.level ?? null,
      barsAgo: lastSwing?.barsAgo ?? null
    },

    internal: {
      direction: lastInternal?.direction ?? "NEUTRAL",
      type: lastInternal?.type ?? "NONE",
      level: lastInternal?.level ?? null,
      barsAgo: lastInternal?.barsAgo ?? null
    },

    swingHigh: swing.highs.at(-1)?.price ?? null,
    swingLow: swing.lows.at(-1)?.price ?? null,

    orderBlocks,

    fairValueGaps: findFVGs(candles),

    equalHigh: findEqualLevels(
      swing.highs,
      averageRange * 0.1
    ),

    equalLow: findEqualLevels(
      swing.lows,
      averageRange * 0.1
    ),

    rangeHigh,
    rangeLow,
    equilibrium,

    zone: current > equilibrium
      ? "PREMIUM"
      : current < equilibrium
        ? "DISCOUNT"
        : "EQUILIBRIUM"
  };
}
