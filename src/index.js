
import { getHistoricalRates } from "dukascopy-node";
import { mkdir, writeFile } from "node:fs/promises";

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

async function downloadTimeframe(timeframe) {
  const to = new Date();
  to.setUTCDate(to.getUTCDate() + 1);

  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 30);

  console.log(`Downloading BTCUSD ${timeframe}...`);

  const candles = await getHistoricalRates({
    instrument: "btcusd",
    dates: {
      from: formatDate(from),
      to: formatDate(to)
    },
    timeframe,
    format: "json",
    volumes: true
  });

  if (!Array.isArray(candles) || candles.length < 60) {
    throw new Error(`Insufficient BTCUSD ${timeframe} candles`);
  }

  const valid = candles.filter(c =>
    [c.open, c.high, c.low, c.close]
      .every(v => Number.isFinite(Number(v))) &&
    Number(c.high) >= Number(c.low)
  );

  if (valid.length < 60) {
    throw new Error(`Insufficient valid BTCUSD candles`);
  }

  await writeFile(
    `data/btcusd-${timeframe}.json`,
    JSON.stringify(valid, null, 2)
  );

  console.log(`${timeframe}: ${valid.length} candles saved`);
}

async function main() {
  await mkdir("data", { recursive: true });

  for (const timeframe of ["m5", "m15", "h1"]) {
    await downloadTimeframe(timeframe);
  }

  console.log("BTCUSD DATA DOWNLOAD COMPLETE");
}

main().catch(error => {
  console.error("BTCUSD DOWNLOAD ERROR:", error);
  process.exitCode = 1;
});
