
import { getHistoricalRates } from "dukascopy-node";
import { mkdir, writeFile } from "node:fs/promises";

const DAYS_BACK = process.argv.includes("--live") ? 14 : 180;

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

async function downloadChunk(timeframe, fromDate, toDate) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await getHistoricalRates({
        instrument: "btcusd",
        dates: { from: fromDate, to: toDate },
        timeframe,
        format: "json"
      });
    } catch (error) {
      lastError = error;
      console.warn(timeframe + " " + fromDate + " to " + toDate + " attempt " + attempt + "/3 failed: " + error.message);
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError;
}

async function downloadTimeframe(timeframe, filename) {
  const to = new Date();
  to.setUTCDate(to.getUTCDate() + 1);

  const from = new Date();
  from.setUTCDate(from.getUTCDate() - DAYS_BACK);

  const fromDate = formatDate(from);
  const toDate = formatDate(to);

  console.log(`Downloading BTC/USD ${timeframe} candles...`);
  console.log(`Period: ${fromDate} to ${toDate}`);

  const collected = [];
  const cursor = new Date(fromDate + "T00:00:00.000Z");
  const end = new Date(toDate + "T00:00:00.000Z");
  while (cursor < end) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + 21 * 86400000, end.getTime()));
    const chunkFrom = formatDate(cursor);
    const chunkTo = formatDate(chunkEnd);
    console.log("Fetching " + timeframe + " chunk " + chunkFrom + " to " + chunkTo);
    const part = await downloadChunk(timeframe, chunkFrom, chunkTo);
    if (Array.isArray(part)) collected.push(...part);
    cursor.setTime(chunkEnd.getTime());
  }
  const unique = new Map();
  for (const candle of collected) {
    const rawTime = candle.timestamp ?? candle.time ?? candle.date;
    const time = typeof rawTime === "number" ? rawTime : Date.parse(rawTime);
    if (Number.isFinite(time)) unique.set(time, candle);
  }
  const candles = [...unique.entries()].sort((a, b) => a[0] - b[0]).map(([, candle]) => candle);

  if (!Array.isArray(candles) || candles.length < 100) {
    throw new Error(
      `Not enough BTC/USD ${timeframe} candles downloaded`
    );
  }

  await writeFile(
    `data/${filename}`,
    JSON.stringify(candles, null, 2)
  );

  console.log(`${timeframe} candles: ${candles.length}`);
  console.log(`Saved: data/${filename}`);
}

async function main() {
  await mkdir("data", { recursive: true });

  await downloadTimeframe("m5", "btcusd-m5.json");
  await downloadTimeframe("m15", "btcusd-m15.json");
  await downloadTimeframe("h1", "btcusd-h1.json");

  console.log("All BTC/USD " + DAYS_BACK + "-day timeframes downloaded successfully.");
}

main().catch(error => {
  console.error("BTC/USD download failed:", error);
  process.exitCode = 1;
});
