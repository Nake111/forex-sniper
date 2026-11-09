import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

const OUTPUT = "dashboard/data/latest.json";
const BTC_PREFIX = (process.env.BTC_DATA_PREFIX ?? "kraken-btcusd").toLowerCase();
const MARKETS = [
  { id: "EURUSD", label: "EUR/USD", prefix: "eurusd" },
  { id: "BTCUSD", label: "BTC/USD", prefix: BTC_PREFIX === "kraken-btcusd" ? "kraken-btcusd" : "btcusd" },
  { id: "XAUUSD", label: "XAU/USD", prefix: "xauusd" }
];
const TIMEFRAMES = [
  { id: "M5", file: "m5", ms: 300000, maxAgeMs: 600000 },
  { id: "M15", file: "m15", ms: 900000, maxAgeMs: 1800000 },
  { id: "H1", file: "h1", ms: 3600000, maxAgeMs: 7200000 },
  { id: "H4", file: "h4", ms: 14400000, maxAgeMs: 28800000 }
];

function timestampOf(c) {
  const raw = c.timestamp ?? c.time ?? c.date;
  const value = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : Date.parse(raw);
  if (!Number.isFinite(value)) return NaN;
  return value < 1e12 ? value * 1000 : value;
}
function validCandle(c) {
  const [o,h,l,cl] = [c.open,c.high,c.low,c.close].map(Number);
  return Number.isFinite(timestampOf(c)) && [o,h,l,cl].every(Number.isFinite) &&
    h >= Math.max(o,cl,l) && l <= Math.min(o,cl,h);
}
async function loadCandles(path, tf, now) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(raw)) throw new Error(path + " is not an array");
  const sorted = raw.filter(validCandle).map(c => ({
    ...c, timestamp: timestampOf(c), open: Number(c.open), high: Number(c.high),
    low: Number(c.low), close: Number(c.close), volume: Number(c.volume ?? 0)
  })).filter(c => c.timestamp + tf.ms <= now).sort((a,b) => a.timestamp-b.timestamp);
  const unique = sorted.filter((c,i) => i === 0 || c.timestamp !== sorted[i-1].timestamp);
  if (unique.length < 60) throw new Error(path + " has fewer than 60 valid closed candles");
  return unique.slice(-120);
}
function quality(candles, tf, now) {
  const last = candles.at(-1);
  const closedAt = last.timestamp + tf.ms;
  const ageMs = Math.max(0, now - closedAt);
  let gaps = 0;
  for (let i=1;i<candles.length;i++) if (candles[i].timestamp-candles[i-1].timestamp > tf.ms*1.5) gaps++;
  const issues = [];
  if (ageMs > tf.maxAgeMs) issues.push("STALE_CLOSED_CANDLE");
  if (gaps >= 10) issues.push("EXCESSIVE_MISSING_INTERVALS_IN_RECENT_WINDOW");
  return { status: issues.length ? "WARN" : "PASS", latestClosedAt: new Date(closedAt).toISOString(),
    ageSeconds: Math.round(ageMs/1000), maxAgeSeconds: Math.round(tf.maxAgeMs/1000),
    candleCount: candles.length, gapCount: gaps, issues };
}
async function main() {
  const now = Date.now();
  const snapshot = { schemaVersion: 1, generatedAt: new Date(now).toISOString(),
    refreshTarget: "5 minutes (GitHub Actions; not a tick stream)", markets: {},
    validation: { status: "PASS", checks: ["valid OHLC", "closed candles only", "sorted and deduplicated timestamps", "minimum 60 bars", "freshness thresholds", "recent interval gaps"] } };
  for (const market of MARKETS) {
    snapshot.markets[market.id] = { label: market.label, dataPrefix: market.prefix, timeframes: {} };
    for (const tf of TIMEFRAMES) {
      const path = "data/" + market.prefix + "-" + tf.file + ".json";
      const candles = await loadCandles(path, tf, now);
      const q = quality(candles, tf, now);
      snapshot.markets[market.id].timeframes[tf.id] = { ...q, source: candles.at(-1).source ?? "provider not tagged",
        latest: candles.at(-1), candles };
      if (q.status !== "PASS") snapshot.validation.status = "WARN";
    }
  }
  await mkdir("dashboard/data", { recursive: true });
  const tmp = OUTPUT + ".tmp";
  await writeFile(tmp, JSON.stringify(snapshot));
  await rename(tmp, OUTPUT);
  console.log("Published website candle snapshot:", OUTPUT);
  console.log("Overall validation:", snapshot.validation.status);
  for (const [symbol,m] of Object.entries(snapshot.markets))
    for (const [tf,item] of Object.entries(m.timeframes))
      console.log(symbol + " " + tf + ": " + item.status + " | " + item.candleCount + " bars | age " + item.ageSeconds + "s | gaps " + item.gapCount);
}
main().catch(error => { console.error("Dashboard data publish failed:", error); process.exitCode = 1; });
