// Forex Sniper Smart Money Concepts Engine
// Independent JavaScript implementation.
// Conceptual reference: LuxAlgo Smart Money Concepts.
// © LuxAlgo — CC BY-NC-SA 4.0
// https://creativecommons.org/licenses/by-nc-sa/4.0/

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

    if (high === null || low === null) continue;

    let isHigh = true;
    let isLow = true;

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

function collectBreaks(candles, pivots, direction, strength) {
  const events = [];

  for (const pivot of pivots) {
    const start = pivot.index + strength + 1;

    for (let i = start; i < candles.length; i++) {
      const previous = n(candles[i - 1].close);
      const close = n(candles[i].close);

      if (previous === null || close === null) continue;

      const crossed = direction === "BULLISH"
        ? previous <= pivot.price && close > pivot.price
        : previous >= pivot.price && close < pivot.price;

      if (crossed) {
        events.push({
          direction,
          level: pivot.price,
          index: i,
          pivotIndex: pivot.index,
          barsAgo: candles.length - 1 - i
        });
        break;
      }
    }
  }

  return events;
}

function classifyEvents(events) {
  const sorted = [...events].sort((a, b) => a.index - b.index);

  let bias = "NEUTRAL";
  const classified = [];

  for (const event of sorted) {
    const previous = classified.at(-1);

    // Avoid ambiguous double breaks on the same candle.
    if (previous && previous.index === event.index) continue;

    const type =
      bias !== "NEUTRAL" && bias !== event.direction
        ? "CHoCH"
        : "BOS";

    classified.push({ ...event, type });
    bias = event.direction;
  }

  return classified;
}

function findOrderBlock(candles, event) {
  if (!event) return null;

  const bullish = event.direction === "BULLISH";
  const searchStart = Math.max(0, event.index - 30);

  const ranges = candles
    .slice(Math.max(0, event.index - 14), event.index)
    .map(c => {
      const high = n(c.high);
      const low = n(c.low);
      return high === null || low === null ? null : high - low;
    })
    .filter(v => v !== null && v > 0);

  if (!ranges.length) return null;

  const averageRange =
    ranges.reduce((sum, value) => sum + value, 0) / ranges.length;

  for (let i = event.index - 1; i >= searchStart; i--) {
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

    let displacement = 0;

    for (let j = i + 1; j <= event.index; j++) {
      const laterClose = n(candles[j].close);
      if (laterClose === null) continue;

      if (bullish) {
        displacement = Math.max(displacement, laterClose - high);
      } else {
        displacement = Math.max(displacement, low - laterClose);
      }
    }

    if (displacement < averageRange * 0.75) continue;

    let touched = false;
    let invalidated = false;

    // Mitigation checks begin only after the structural break.
    for (let j = event.index + 1; j < candles.length; j++) {
      const laterHigh = n(candles[j].high);
      const laterLow = n(candles[j].low);
      const laterClose = n(candles[j].close);

      if (
        laterHigh === null ||
        laterLow === null ||
        laterClose === null
      ) continue;

      if (laterHigh >= low && laterLow <= high) {
        touched = true;
      }

      if (bullish && laterClose < low) {
        invalidated = true;
      }

      if (!bullish && laterClose > high) {
        invalidated = true;
      }
    }

    return {
      direction: event.direction,
      high,
      low,
      barsAgo: candles.length - 1 - i,
      displacement,
      touched,
      mitigated: touched,
      invalidated
    };
  }

  return null;
}

function findFVGs(candles) {
  const gaps = [];
  const start = Math.max(2, candles.length - 50);

  for (let i = start; i < candles.length; i++) {
    const firstHigh = n(candles[i - 2].high);
    const firstLow = n(candles[i - 2].low);
    const currentHigh = n(candles[i].high);
    const currentLow = n(candles[i].low);

    if (
      [firstHigh, firstLow, currentHigh, currentLow]
        .some(v => v === null)
    ) continue;

    let direction;
    let top;
    let bottom;

    if (currentLow > firstHigh) {
      direction = "BULLISH";
      top = currentLow;
      bottom = firstHigh;
    } else if (currentHigh < firstLow) {
      direction = "BEARISH";
      top = firstLow;
      bottom = currentHigh;
    } else {
      continue;
    }

    let touched = false;
    let filled = false;

    for (let j = i + 1; j < candles.length; j++) {
      const high = n(candles[j].high);
      const low = n(candles[j].low);

      if (high === null || low === null) continue;

      if (direction === "BULLISH") {
        if (low <= top) touched = true;
        if (low <= bottom) filled = true;
      } else {
        if (high >= bottom) touched = true;
        if (high >= top) filled = true;
      }
    }

    if (!filled) {
      gaps.push({
        direction,
        top,
        bottom,
        barsAgo: candles.length - 1 - i,
        touched,
        filled
      });
    }
  }

  return gaps.slice(-5).reverse();
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

function publicEvent(event) {
  return {
    direction: event?.direction ?? "NEUTRAL",
    type: event?.type ?? "NONE",
    level: event?.level ?? null,
    barsAgo: event?.barsAgo ?? null
  };
}

export function analyzeSmartMoney(candles) {
  if (!Array.isArray(candles) || candles.length < 60) {
    throw new Error("Not enough candles for SMC analysis.");
  }

  const swingStrength = 10;
  const internalStrength = 3;

  const swingPivots = findPivots(candles, swingStrength);
  const internalPivots = findPivots(candles, internalStrength);

  const swingEvents = classifyEvents([
    ...collectBreaks(candles, swingPivots.highs, "BULLISH", swingStrength),
    ...collectBreaks(candles, swingPivots.lows, "BEARISH", swingStrength)
  ]);

  const internalEvents = classifyEvents([
    ...collectBreaks(candles, internalPivots.highs, "BULLISH", internalStrength),
    ...collectBreaks(candles, internalPivots.lows, "BEARISH", internalStrength)
  ]);

  const lastSwing = swingEvents.at(-1) ?? null;
  const lastInternal = internalEvents.at(-1) ?? null;

  const lastBullish = [...swingEvents]
    .reverse()
    .find(event => event.direction === "BULLISH");

  const lastBearish = [...swingEvents]
    .reverse()
    .find(event => event.direction === "BEARISH");

  const orderBlocks = [
    findOrderBlock(candles, lastBullish),
    findOrderBlock(candles, lastBearish)
  ].filter(Boolean);

  const recent = candles.slice(-50);
  const highs = recent.map(c => n(c.high)).filter(v => v !== null);
  const lows = recent.map(c => n(c.low)).filter(v => v !== null);

  if (!highs.length || !lows.length) {
    throw new Error("Invalid price range for SMC analysis.");
  }

  const rangeHigh = Math.max(...highs);
  const rangeLow = Math.min(...lows);
  const equilibrium = (rangeHigh + rangeLow) / 2;
  const current = n(candles.at(-1).close);

  const recentRanges = candles.slice(-15)
    .map(c => {
      const high = n(c.high);
      const low = n(c.low);
      return high === null || low === null ? null : high - low;
    })
    .filter(v => v !== null);

  const averageRange = recentRanges.length
    ? recentRanges.reduce((a, b) => a + b, 0) / recentRanges.length
    : 0;

  return {
    swing: publicEvent(lastSwing),
    internal: publicEvent(lastInternal),

    swingHigh: swingPivots.highs.at(-1)?.price ?? null,
    swingLow: swingPivots.lows.at(-1)?.price ?? null,

    orderBlocks,
    fairValueGaps: findFVGs(candles),

    equalHigh: findEqualLevels(swingPivots.highs, averageRange * 0.1),
    equalLow: findEqualLevels(swingPivots.lows, averageRange * 0.1),

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
