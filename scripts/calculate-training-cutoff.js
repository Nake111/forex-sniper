import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const DATA_DIR = process.env.DATA_DIR ?? "data";
const OUTPUT = process.env.TRAINING_CUTOFF_OUTPUT ?? "reports/training-cutoff.json";
const MARKETS = ["eurusd", "btcusd", "xauusd"];

function timestamp(candle) {
  const raw = candle.timestamp ?? candle.time ?? candle.date;
  const value = typeof raw === "number"
    ? raw
    : typeof raw === "string" && /^\d+(?:\.\d+)?$/.test(raw)
      ? Number(raw)
      : Date.parse(raw);
  if (!Number.isFinite(value)) return NaN;
  return value < 1e12 ? value * 1000 : value;
}

async function loadMarket(prefix) {
  const path = DATA_DIR + "/" + prefix + "-m5.json";
  const bytes = await readFile(path);
  const parsed = JSON.parse(bytes.toString("utf8"));
  if (!Array.isArray(parsed)) throw new Error(path + " must contain a JSON candle array");
  const rows = parsed.map(row => ({ time: timestamp(row) }))
    .filter(row => Number.isFinite(row.time))
    .sort((a, b) => a.time - b.time);
  const unique = [...new Set(rows.map(row => row.time))];
  if (unique.length < 1000) throw new Error(prefix + ": only " + unique.length + " valid M5 timestamps; refusing to freeze a short or incomplete history");
  return {
    prefix,
    path,
    hash: createHash("sha256").update(bytes).digest("hex"),
    timestamps: unique
  };
}

async function main() {
  const markets = await Promise.all(MARKETS.map(loadMarket));
  const commonStart = Math.max(...markets.map(m => m.timestamps[0]));
  const commonEnd = Math.min(...markets.map(m => m.timestamps.at(-1)));
  if (!(commonEnd > commonStart)) throw new Error("Markets have no common chronological data window");

  const commonTimeline = [...new Set(markets.flatMap(m =>
    m.timestamps.filter(t => t >= commonStart && t <= commonEnd)
  ))].sort((a, b) => a - b);
  if (commonTimeline.length < 1000) throw new Error("Common market timeline is too short to establish a reliable 70/30 split");

  const trainingCount = Math.floor(commonTimeline.length * 0.7);
  if (trainingCount < 1 || trainingCount >= commonTimeline.length) throw new Error("Invalid 70/30 split");
  const cutoffMs = commonTimeline[trainingCount - 1];
  const holdoutStartMs = commonTimeline[trainingCount];
  const perMarket = markets.map(m => {
    const inWindow = m.timestamps.filter(t => t >= commonStart && t <= commonEnd);
    const training = inWindow.filter(t => t <= cutoffMs).length;
    const holdout = inWindow.length - training;
    return {
      market: m.prefix.toUpperCase(),
      file: m.path,
      sha256: m.hash,
      candlesInCommonWindow: inWindow.length,
      trainingCandles: training,
      holdoutCandles: holdout,
      trainingSharePct: Number((training / inWindow.length * 100).toFixed(2)),
      firstCandle: new Date(inWindow[0]).toISOString(),
      lastCandle: new Date(inWindow.at(-1)).toISOString()
    };
  });

  const result = {
    status: "CALCULATED_NOT_YET_FROZEN",
    method: "70% of unique chronological M5 timestamps across the shared EURUSD/BTCUSD/XAUUSD history window; final 30% remains untouched holdout",
    timezone: "UTC",
    commonWindowStart: new Date(commonStart).toISOString(),
    commonWindowEnd: new Date(commonEnd).toISOString(),
    trainingCandleCount: trainingCount,
    totalUniqueTimestamps: commonTimeline.length,
    trainingCutoff: new Date(cutoffMs).toISOString(),
    holdoutStartsAt: new Date(holdoutStartMs).toISOString(),
    holdoutRead: false,
    datasets: perMarket
  };

  if (perMarket.some(m => m.trainingSharePct < 65 || m.trainingSharePct > 75)) {
    throw new Error("Per-market split deviates materially from 70/30; inspect data coverage before accepting this cutoff. Details: " + JSON.stringify(perMarket));
  }
  await mkdir("reports", { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error("TRAINING CUTOFF CALCULATION FAILED:", error);
  process.exitCode = 1;
});
