import { readFile } from "node:fs/promises";

const daysBack = Number(process.env.DATA_DAYS_BACK ?? 180);
const btcPrefix = (process.env.BTC_DATA_PREFIX ?? "btcusd").toLowerCase();
const now = Date.now();
const cutoff = now - daysBack * 86_400_000;
const tolerance = 3 * 86_400_000;
const markets = [
  { market: "EURUSD", prefix: "eurusd" },
  { market: "BTCUSD", prefix: btcPrefix },
  { market: "XAUUSD", prefix: "xauusd" }
];

for (const { market, prefix } of markets) {
  for (const timeframe of ["m5", "m15", "h1"]) {
    const path = `data/${prefix}-${timeframe}.json`;
    const candles = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(candles) || candles.length < 100) throw new Error(`${market} ${timeframe}: insufficient candles`);
    const times = candles.map(c => Number(c.timestamp ?? c.time)).filter(Number.isFinite).sort((a, b) => a - b);
    const earliest = times[0] < 1e12 ? times[0] * 1000 : times[0];
    const latestRaw = times.at(-1);
    const latest = latestRaw < 1e12 ? latestRaw * 1000 : latestRaw;
    if (earliest > cutoff + tolerance) throw new Error(`${market} ${timeframe}: history starts ${Math.round((earliest - cutoff) / 86_400_000)} days after requested cutoff; 180-day coverage is incomplete`);
    if (latest < now - 2 * 86_400_000) throw new Error(`${market} ${timeframe}: latest candle is older than 2 days`);
    console.log(`${market} ${timeframe}: ${candles.length} candles; ${new Date(earliest).toISOString()} → ${new Date(latest).toISOString()}`);
  }
}
console.log(`PASS: all three markets have at least ${daysBack - 3} days of historical candle coverage.`);
