import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const path = process.env.QUOTE_HISTORY_PATH ?? join(process.env.DATA_DIR ?? "data", "historical-bid-ask.jsonl");
let writeQueue = Promise.resolve();
let writeErrors = 0;

function finite(value) { return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)); }

/**
 * Persist every normalized live quote as immutable NDJSON evidence.
 * Provider timestamps are preserved; receipt time is stored separately.
 * Invalid/stale quotes are retained for diagnostics but never promoted to valid.
 */
export function recordHistoricalQuote(market, quote, receivedAt = Date.now()) {
  const bid = finite(quote?.bid) ? Number(quote.bid) : null;
  const ask = finite(quote?.ask) ? Number(quote.ask) : null;
  const providerTimestamp = finite(quote?.timestamp) ? Number(quote.timestamp) : null;
  const spread = bid !== null && ask !== null ? ask - bid : null;
  const midpoint = bid !== null && ask !== null ? (bid + ask) / 2 : null;
  const ageMs = providerTimestamp !== null ? receivedAt - providerTimestamp : null;
  const validPrices = bid !== null && ask !== null && bid > 0 && ask >= bid;
  const validTimestamp = providerTimestamp !== null && ageMs !== null && ageMs >= 0;
  const record = {
    schemaVersion: 1,
    eventType: "HISTORICAL_BID_ASK",
    market,
    symbol: quote?.symbol ?? market,
    provider: quote?.source ?? null,
    venue: quote?.venue ?? null,
    bid, ask, midpoint, spread,
    spreadBps: spread !== null && midpoint > 0 ? spread / midpoint * 10_000 : null,
    providerTimestamp,
    providerTimestampIso: providerTimestamp !== null ? new Date(providerTimestamp).toISOString() : null,
    receivedAt,
    receivedAtIso: new Date(receivedAt).toISOString(),
    quoteAgeMs: ageMs,
    timestampQuality: quote?.timestampQuality ?? "UNKNOWN",
    marketState: quote?.marketState ?? null,
    tradeable: quote?.tradeable === true,
    validation: {
      pricesValid: validPrices,
      timestampValid: validTimestamp,
      freshWithin15s: ageMs !== null && ageMs >= 0 && ageMs <= 15_000,
      valid: validPrices && validTimestamp && ageMs <= 15_000
    }
  };
  writeQueue = writeQueue.then(async () => {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(record) + "\\n", { encoding: "utf8", flag: "a" });
  }).catch(error => {
    writeErrors++;
    console.error("HISTORICAL QUOTE PERSISTENCE FAILED:", error.message);
  });
  return { queued: true, path, record, getWriteErrors: () => writeErrors };
}

export async function flushHistoricalQuotes() {
  await writeQueue;
  return { path, writeErrors };
}
