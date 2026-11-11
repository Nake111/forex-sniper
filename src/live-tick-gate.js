import { readFile } from "node:fs/promises";

export const LIVE_TICK_MAX_AGE_MS = 800;

function toTimestamp(value) {
  if (typeof value === "number" || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))) {
    const numeric = Number(value);
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function evaluateLiveTick(record, expectedSymbol, now = Date.now()) {
  if (!record || typeof record !== "object") {
    return { ok: false, reason: "LIVE_TICK_MISSING", ageMs: null };
  }

  const symbol = String(record.symbol ?? "").toUpperCase();
  if (symbol !== String(expectedSymbol).toUpperCase()) {
    return { ok: false, reason: "LIVE_TICK_SYMBOL_MISMATCH", ageMs: null };
  }

  const receivedAt = toTimestamp(record.receivedAt);
  const sourceTimestamp = toTimestamp(record.timestamp);
  const price = Number(record.price);
  if (!Number.isFinite(receivedAt) || !Number.isFinite(sourceTimestamp) || !Number.isFinite(price) || price <= 0) {
    return { ok: false, reason: "LIVE_TICK_INVALID_FIELDS", ageMs: null };
  }

  const ageMs = now - receivedAt;
  if (ageMs < 0) return { ok: false, reason: "LIVE_TICK_RECEIVE_TIME_IN_FUTURE", ageMs };
  if (ageMs > LIVE_TICK_MAX_AGE_MS) {
    return { ok: false, reason: "LIVE_TICK_STALE", ageMs, maxAgeMs: LIVE_TICK_MAX_AGE_MS };
  }

  return {
    ok: true,
    reason: "LIVE_TICK_FRESH",
    symbol,
    price,
    source: String(record.source ?? "unspecified"),
    receivedAt,
    sourceTimestamp,
    ageMs,
    maxAgeMs: LIVE_TICK_MAX_AGE_MS
  };
}

export async function getLiveTickGate(symbol, now = Date.now()) {
  const path = `data/live-ticks/${String(symbol).toUpperCase()}.json`;
  try {
    const record = JSON.parse(await readFile(path, "utf8"));
    return evaluateLiveTick(record, symbol, now);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { ok: false, reason: "LIVE_TICK_FILE_MISSING", path, ageMs: null };
    }
    return { ok: false, reason: "LIVE_TICK_READ_ERROR", path, detail: error.message, ageMs: null };
  }
}
