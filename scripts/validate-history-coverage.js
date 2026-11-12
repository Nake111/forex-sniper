import { readFile } from "node:fs/promises";

const daysBack = Number(process.env.DATA_DAYS_BACK ?? 180);
const markets = [
  { name: "EURUSD", prefix: "eurusd" },
  { name: "BTCUSD", prefix: (process.env.BTC_DATA_PREFIX ?? "btcusd").toLowerCase() },
  { name: "XAUUSD", prefix: "xauusd" }
];
const frames = [
  { name: "m5", interval: 5 * 60_000 },
  { name: "m15", interval: 15 * 60_000 },
  { name: "h1", interval: 60 * 60_000 },
  { name: "h4", interval: 4 * 60 * 60_000 }
];
const now = Date.now();
const earliestAllowed = now - (daysBack + 10) * 86_400_000;
const latestAllowed = now - 4 * 60 * 60_000;
const errors = [];

for (const market of markets) {
  for (const frame of frames) {
    const path = `data/${market.prefix}-${frame.name}.json`;
    let candles;
    try {
      candles = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      errors.push(`${path}: cannot read: ${error.message}`);
      continue;
    }
    if (!Array.isArray(candles)) {
      errors.push(`${path}: expected an array`);
      continue;
    }
    const times = candles.map(c => {
      const raw = c.timestamp ?? c.time ?? c.date;
      const value = typeof raw === "number" ? raw : Date.parse(raw);
      return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : NaN;
    }).filter(Number.isFinite).sort((a, b) => a - b);
    if (times.length < 100) errors.push(`${path}: only ${times.length} valid timestamped rows`);
    if (!times.length) continue;
    if (times[0] > earliestAllowed) errors.push(`${path}: history starts too recently (${new Date(times[0]).toISOString()})`);
    if (times.at(-1) > latestAllowed) errors.push(`${path}: contains a candle that may not yet be closed`);
    const uniqueCount = new Set(times).size;
    if (uniqueCount !== times.length) errors.push(`${path}: duplicate timestamps detected`);
    console.log(`${path}: rows=${times.length}, start=${new Date(times[0]).toISOString()}, end=${new Date(times.at(-1)).toISOString()}`);
  }
}

if (errors.length) {
  for (const error of errors) console.error("COVERAGE ERROR:", error);
  throw new Error(`Historical coverage validation failed with ${errors.length} issue(s)`);
}
console.log(`Historical coverage validation passed for ${markets.length} markets × ${frames.length} timeframes; required history ${daysBack} days (10-day tolerance).`);
