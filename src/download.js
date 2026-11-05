import { getHistoricalRates } from "dukascopy-node";
import { mkdir, writeFile } from "node:fs/promises";

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

async function downloadTimeframe(timeframe, filename) {
  const to = new Date();
  to.setUTCDate(to.getUTCDate() + 1);

  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 30);

  console.log(`Downloading EUR/USD ${timeframe} candles...`);

  const candles = await getHistoricalRates({
    instrument: "eurusd",
    dates: {
      from: formatDate(from),
      to: formatDate(to)
    },
    timeframe,
    format: "json"
  });

  if (!Array.isArray(candles) || candles.length < 50) {
    throw new Error(`Not enough ${timeframe} candles downloaded`);
  }

  await writeFile(
    `data/${filename}`,
    JSON.stringify(candles, null, 2)
  );

  console.log(`${timeframe} candles:`, candles.length);
  console.log(`Saved: data/${filename}`);
}

async function main() {
  await mkdir("data", { recursive: true });

  await downloadTimeframe("m5", "eurusd-m5.json");
  await downloadTimeframe("m15", "eurusd-m15.json");
  await downloadTimeframe("h1", "eurusd-h1.json");

  console.log("All three timeframes downloaded successfully.");
}

main().catch(error => {
  console.error("Download failed:", error);
  process.exitCode = 1;
});
