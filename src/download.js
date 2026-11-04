import { getHistoricalRates } from "dukascopy-node";
import { mkdir, writeFile } from "node:fs/promises";

async function downloadForexData() {
  console.log("Downloading EUR/USD 5-minute candles...");

  const candles = await getHistoricalRates({
    instrument: "eurusd",
    dates: {
      from: "2025-01-01",
      to: "2025-01-08"
    },
    timeframe: "m5",
    format: "json"
  });

  await mkdir("data", { recursive: true });

  await writeFile(
    "data/eurusd-m5.json",
    JSON.stringify(candles, null, 2)
  );

  console.log(`Downloaded ${candles.length} candles.`);
  console.log("Saved to data/eurusd-m5.json");
}

downloadForexData().catch((error) => {
  console.error("Download failed:", error);
  process.exitCode = 1;
});
