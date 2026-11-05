
function getTime(candle) {
  const value = candle.timestamp ?? candle.time ?? candle.date;

  if (value == null) return null;

  let time = typeof value === "number" ? value : Date.parse(value);

  if (!Number.isFinite(time)) return null;

  if (time < 1e12) time *= 1000;

  return time;
}

export function analyzeMarketStructure(candles, strength = 3) {
  if (!Array.isArray(candles) || candles.length < strength * 2 + 2) {
    throw new Error("Not enough candles for market structure");
  }

  const swings = [];

  for (let i = strength; i < candles.length - strength; i++) {
    const high = Number(candles[i].high);
    const low = Number(candles[i].low);

    const left = candles.slice(i - strength, i);
    const right = candles.slice(i + 1, i + strength + 1);

    const swingHigh = [...left, ...right].every(
      c => high > Number(c.high)
    );

    const swingLow = [...left, ...right].every(
      c => low < Number(c.low)
    );

    if (swingHigh) {
      swings.push({ type: "HIGH", price: high, index: i });
    }

    if (swingLow) {
      swings.push({ type: "LOW", price: low, index: i });
    }
  }

  const last = candles[candles.length - 1];
  const previous = candles[candles.length - 2];

  const latestHigh = [...swings].reverse().find(s => s.type === "HIGH");
  const latestLow = [...swings].reverse().find(s => s.type === "LOW");

  let bos = "NONE";
  let liquiditySweep = "NONE";

  if (latestHigh && Number(last.close) > latestHigh.price) {
    bos = "BULLISH";
  } else if (latestLow && Number(last.close) < latestLow.price) {
    bos = "BEARISH";
  }

  if (
    latestHigh &&
    Number(previous.high) <= latestHigh.price &&
    Number(last.high) > latestHigh.price &&
    Number(last.close) < latestHigh.price
  ) {
    liquiditySweep = "BEARISH";
  }

  if (
    latestLow &&
    Number(previous.low) >= latestLow.price &&
    Number(last.low) < latestLow.price &&
    Number(last.close) > latestLow.price
  ) {
    liquiditySweep = "BULLISH";
  }

  const latestTime = getTime(last);
  let previousDayHigh = null;
  let previousDayLow = null;

  if (latestTime !== null) {
    const previousDay = new Date(latestTime - 86400000)
      .toISOString()
      .slice(0, 10);

    const dayCandles = candles.filter(c => {
      const time = getTime(c);

      return time !== null &&
        new Date(time).toISOString().slice(0, 10) === previousDay;
    });

    if (dayCandles.length) {
      previousDayHigh = Math.max(
        ...dayCandles.map(c => Number(c.high))
      );

      previousDayLow = Math.min(
        ...dayCandles.map(c => Number(c.low))
      );
    }
  }

  return {
    swingHigh: latestHigh?.price ?? null,
    swingLow: latestLow?.price ?? null,
    bos,
    liquiditySweep,
    previousDayHigh,
    previousDayLow
  };
}
