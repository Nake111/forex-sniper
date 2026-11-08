const BASE = "https://www.deribit.com/api/v2/public";
const DAY_MS = 86_400_000;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function optionGamma(spot, strike, years, volatility) {
  if (![spot, strike, years, volatility].every(Number.isFinite) ||
      spot <= 0 || strike <= 0 || years <= 0 || volatility <= 0) return null;
  const sigmaRootT = volatility * Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + 0.5 * volatility ** 2 * years) / sigmaRootT;
  return normalPdf(d1) / (spot * sigmaRootT);
}

function decodeInstrument(instrument) {
  const match = /^(BTC|ETH)-(\d{1,2}[A-Z]{3}\d{2})-(\d+)-(C|P)$/.exec(instrument ?? "");
  return match ? { currency: match[1], strike: Number(match[3]), type: match[4] === "C" ? "call" : "put" } : null;
}

async function getJson(url, fetchImpl, timeoutMs) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Deribit HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message ?? "Deribit API error");
  return payload.result;
}

/**
 * Read-only BTC options positioning snapshot from Deribit's public API.
 * OI-based levels are approximate because Deribit reports public OI with an 8-hour delay.
 * Open interest does not reveal whether dealers are long or short; gross gamma is not signed dealer GEX.
 */
export async function fetchBtcOptionsWalls({
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  timeoutMs = 12_000
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable in this runtime");
  const [instruments, summaries] = await Promise.all([
    getJson(`${BASE}/get_instruments?currency=BTC&kind=option&expired=false`, fetchImpl, timeoutMs),
    getJson(`${BASE}/get_book_summary_by_currency?currency=BTC&kind=option`, fetchImpl, timeoutMs)
  ]);
  if (!Array.isArray(instruments) || !Array.isArray(summaries)) {
    throw new Error("Unexpected Deribit options response");
  }

  const metadata = new Map(instruments.map(item => [item.instrument_name, item]));
  const joined = summaries.map(row => {
    const meta = metadata.get(row.instrument_name);
    const parsed = decodeInstrument(row.instrument_name);
    const expiry = finite(meta?.expiration_timestamp);
    const strike = finite(meta?.strike) ?? parsed?.strike;
    const type = meta?.option_type ?? parsed?.type;
    const spot = finite(row.underlying_price);
    const ivRaw = finite(row.mark_iv);
    const iv = ivRaw !== null && ivRaw > 0 ? (ivRaw > 3 ? ivRaw / 100 : ivRaw) : null;
    const oi = finite(row.open_interest);
    const volume = finite(row.volume);
    if (!meta || !expiry || expiry <= now || !strike || !type || !spot || !iv || oi === null || volume === null) return null;
    return { strike, type, expiry, spot, iv, oi: Math.max(0, oi), volume: Math.max(0, volume), instrument: row.instrument_name };
  }).filter(Boolean);

  if (!joined.length) throw new Error("No valid active BTC options contracts returned");

  const nearestExpiry = Math.min(...joined.map(row => row.expiry));
  const chain = joined.filter(row => row.expiry === nearestExpiry);
  const spot = chain.reduce((sum, row) => sum + row.spot, 0) / chain.length;
  const years = Math.max((nearestExpiry - now) / (365 * DAY_MS), 1 / (365 * 24));
  const byStrike = new Map();
  for (const row of chain) {
    const level = byStrike.get(row.strike) ?? {
      strike: row.strike, callOi: 0, putOi: 0, callVolume: 0, putVolume: 0,
      grossGammaExposure: 0, weightedIv: 0, ivWeight: 0
    };
    const isCall = row.type === "call";
    if (isCall) {
      level.callOi += row.oi;
      level.callVolume += row.volume;
    } else {
      level.putOi += row.oi;
      level.putVolume += row.volume;
    }
    const gamma = optionGamma(spot, row.strike, years, row.iv);
    if (gamma !== null) level.grossGammaExposure += gamma * row.oi * spot * spot * 0.01;
    const weight = row.oi;
    level.weightedIv += row.iv * weight;
    level.ivWeight += weight;
    byStrike.set(row.strike, level);
  }
  const levels = [...byStrike.values()].sort((a, b) => a.strike - b.strike).map(level => ({
    ...level,
    totalOi: level.callOi + level.putOi,
    totalVolume: level.callVolume + level.putVolume,
    oiWeightedIv: level.ivWeight > 0 ? level.weightedIv / level.ivWeight : null
  }));
  const maxBy = key => levels.reduce((best, level) => level[key] > (best?.[key] ?? -1) ? level : best, null);
  const callWall = levels.reduce((best, level) => level.callOi > (best?.callOi ?? -1) ? level : best, null);
  const putWall = levels.reduce((best, level) => level.putOi > (best?.putOi ?? -1) ? level : best, null);
  const volumeWall = maxBy("totalVolume");
  const ivWall = levels.reduce((best, level) => level.oiWeightedIv !== null &&
    level.totalOi > 0 && (!best || level.totalOi * level.oiWeightedIv > best.totalOi * best.oiWeightedIv) ? level : best, null);

  let maxPain = null;
  let lowestPain = Infinity;
  for (const settlement of levels.map(level => level.strike)) {
    const pain = levels.reduce((sum, level) =>
      sum + level.callOi * Math.max(0, settlement - level.strike) +
        level.putOi * Math.max(0, level.strike - settlement), 0);
    if (pain < lowestPain) { lowestPain = pain; maxPain = settlement; }
  }

  return {
    provider: "Deribit public market data",
    currency: "BTC",
    spot,
    expiry: new Date(nearestExpiry).toISOString(),
    daysToExpiry: Math.max(0, (nearestExpiry - now) / DAY_MS),
    callWall: callWall ? { strike: callWall.strike, openInterest: callWall.callOi } : null,
    putWall: putWall ? { strike: putWall.strike, openInterest: putWall.putOi } : null,
    volumeWall: volumeWall ? { strike: volumeWall.strike, volume: volumeWall.totalVolume } : null,
    ivConcentration: ivWall ? { strike: ivWall.strike, impliedVolatility: ivWall.oiWeightedIv } : null,
    maxPain,
    grossGammaExposureProxy: levels.reduce((sum, level) => sum + level.grossGammaExposure, 0),
    levels,
    contractCount: chain.length,
    dataNotes: [
      "Public open interest is delayed by 8 hours on Deribit.",
      "Open interest does not identify dealer positioning; gamma exposure is unsigned and approximate.",
      "Options positioning is context only and does not independently create a BUY or SELL signal."
    ]
  };
}

export function summarizeOptionsContext(snapshot, price = snapshot?.spot) {
  if (!snapshot || !Number.isFinite(price)) return { available: false, bias: "NEUTRAL" };
  const call = snapshot.callWall?.strike;
  const put = snapshot.putWall?.strike;
  let bias = "NEUTRAL";
  if (Number.isFinite(call) && Number.isFinite(put)) {
    if (price > call) bias = "ABOVE_CALL_WALL";
    else if (price < put) bias = "BELOW_PUT_WALL";
    else if (price < call && price > put) bias = "BETWEEN_WALLS";
  }
  return {
    available: true,
    bias,
    callWall: call ?? null,
    putWall: put ?? null,
    maxPain: snapshot.maxPain ?? null,
    expiry: snapshot.expiry
  };
}
