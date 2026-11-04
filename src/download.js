import { getHistoricalRates } from "dukascopy-node";
import { mkdir, writeFile } from "node:fs/promises";

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

async function downloadForexData() {
  const to = new Date();
  to.setUTCDate(to.getUTCDate() + 1);

  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 30);

  console.log("Downloading recent EUR/USD 5-minute candles...");
  console.log("From:", formatDate(from));
  console.log("To:", formatDate(to));

  const candles = await getHistoricalRates({
    instrument: "eurusd",
    dates: {
      from: formatDate(from),
      to: formatDate(to)
    },
    timeframe: "m5",
    format: "json"
  });

  if (!Array.isArray(candles) || candles.length < 50) {
    throw new Error("Not enough recent EUR/USD data downloaded");
  }

  await mkdir("data", { recursive: true });

  await writeFile(
    "data/eurusd-m5.json",
    JSON.stringify(candles, null, 2)
  );

  console.log("Downloaded candles:", candles.length);
  console.log("Saved to data/eurusd-m5.json");
}

downloadForexData().catch(error => {
  console.error("Download failed:", error);
  process.exitCode = 1;
});
