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

  console.log(`Downloading BTC/USD ${timeframe} candles...`);

  const candles = await getHistoricalRates({
    instrument: "btcusd",
    dates: {
      from: formatDate(from),
      to: formatDate(to)
    },
    timeframe,
    format: "json"
  });

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

  console.log("All BTC/USD timeframes downloaded successfully.");
}

main().catch(error => {
  console.error("BTC/USD download failed:", error);
  process.exitCode = 1;
});
