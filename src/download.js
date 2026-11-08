import { getHistoricalRates } from "dukascopy-node";
import { mkdir, writeFile } from "node:fs/promises";

const DAYS_BACK = Number(process.env.DATA_DAYS_BACK ?? 180);
const MARKETS = [
  { label: "EUR/USD", instrument: "eurusd", prefix: "eurusd" },
  { label: "BTC/USD", instrument: "btcusd", prefix: "btcusd" },
  { label: "Gold XAU/USD", instrument: "xauusd", prefix: "xauusd" }
];
const TIMEFRAMES = ["m5", "m15", "h1", "h4"];
const MARKET_FILTER = process.env.MARKET_FILTER?.toUpperCase();
const SELECTED_MARKETS = MARKET_FILTER ? MARKETS.filter(market => market.prefix.toUpperCase() === MARKET_FILTER) : MARKETS;
if (MARKET_FILTER && SELECTED_MARKETS.length === 0) throw new Error("Unknown MARKET_FILTER: " + MARKET_FILTER);

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

async function downloadOne(market, timeframe) {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - DAYS_BACK);

  console.log(`Downloading ${market.label} ${timeframe.toUpperCase()} candles...`);
  const candles = await getHistoricalRates({
    instrument: market.instrument,
    dates: { from: formatDate(from), to: formatDate(to) },
    timeframe,
    format: "json",
    volumes: true,
    useCache: true
  });

  if (!Array.isArray(candles) || candles.length < 100) {
    throw new Error(`Not enough ${market.label} ${timeframe.toUpperCase()} candles: ${candles?.length ?? 0}`);
  }

  const path = `data/${market.prefix}-${timeframe}.json`;
  await writeFile(path, JSON.stringify(candles));
  console.log(`${market.label} ${timeframe.toUpperCase()}: ${candles.length} candles saved to ${path}`);
}

async function main() {
  if (!Number.isInteger(DAYS_BACK) || DAYS_BACK < 30 || DAYS_BACK > 730) {
    throw new Error("DATA_DAYS_BACK must be an integer between 30 and 730");
  }
  await mkdir("data", { recursive: true });
  for (const market of SELECTED_MARKETS) {
    for (const timeframe of TIMEFRAMES) await downloadOne(market, timeframe);
  }
  console.log("Selected market datasets downloaded:", SELECTED_MARKETS.map(market => market.label).join(", "));
}

main().catch(error => {
  console.error("Market data download failed:", error);
  process.exitCode = 1;
});
