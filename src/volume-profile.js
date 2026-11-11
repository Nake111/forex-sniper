
export function calculateVolumeProfile(candles, binCount = 24, valueAreaPercent = 0.70) {
  if (!Array.isArray(candles) || candles.length < 2) {
    throw new Error("Not enough candles for Volume Profile");
  }

  if (!Number.isInteger(binCount) || binCount < 2) {
    throw new Error("binCount must be at least 2");
  }

  if (valueAreaPercent <= 0 || valueAreaPercent > 1) {
    throw new Error("Value area percent must be between 0 and 1");
  }

  const prices = candles.flatMap(c => [
    Number(c.high),
    Number(c.low)
  ]);

  if (prices.some(p => !Number.isFinite(p))) {
    throw new Error("Invalid candle prices");
  }

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const binSize = (maxPrice - minPrice) / binCount;

  if (binSize <= 0) {
    throw new Error("Invalid price range");
  }

  const bins = Array(binCount).fill(0);

  for (const candle of candles) {
    const low = Number(candle.low);
    const high = Number(candle.high);
    const volume = Number(candle.volume);

    if (!Number.isFinite(volume) || volume < 0) {
      throw new Error("Invalid candle volume");
    }

    const firstBin = Math.max(
      0,
      Math.min(binCount - 1, Math.floor((low - minPrice) / binSize))
    );

    const lastBin = Math.max(
      0,
      Math.min(binCount - 1, Math.floor((high - minPrice) / binSize))
    );

    const touchedBins = lastBin - firstBin + 1;
    const volumePerBin = volume / touchedBins;

    for (let i = firstBin; i <= lastBin; i++) {
      bins[i] += volumePerBin;
    }
  }

  const totalVolume = bins.reduce((sum, value) => sum + value, 0);

  if (totalVolume <= 0) {
    // Some FX/CFD feeds expose no volume. Never fabricate a volume profile;
    // mark it unavailable and allow price-only analysis to continue.
    return {
      available: false,
      reason: "NO_VOLUME_DATA",
      poc: null,
      valueAreaHigh: null,
      valueAreaLow: null,
      totalVolume: 0,
      binSize,
      bins
    };
  }

  const pocIndex = bins.indexOf(Math.max(...bins));

  let left = pocIndex;
  let right = pocIndex;
  let accumulatedVolume = bins[pocIndex];

  const targetVolume = totalVolume * valueAreaPercent;

  while (accumulatedVolume < targetVolume) {
    const leftVolume = left > 0 ? bins[left - 1] : -1;
    const rightVolume = right < binCount - 1 ? bins[right + 1] : -1;

    if (leftVolume === -1 && rightVolume === -1) break;

    if (rightVolume > leftVolume) {
      right++;
      accumulatedVolume += bins[right];
    } else {
      left--;
      accumulatedVolume += bins[left];
    }
  }

  const priceAt = index => minPrice + (index + 0.5) * binSize;

  return {
    available: true,
    reason: null,
    poc: priceAt(pocIndex),
    valueAreaHigh: minPrice + (right + 1) * binSize,
    valueAreaLow: minPrice + left * binSize,
    totalVolume,
    binSize,
    bins
  };
}
