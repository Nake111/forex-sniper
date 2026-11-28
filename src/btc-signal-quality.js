const MAX_ORDER_FLOW_AGE_MS = 30_000;

const finite = value => Number.isFinite(Number(value));
const number = value => Number(value);

export async function fetchBtcOrderFlowEvidence({
  fetchImpl = globalThis.fetch,
  url = process.env.BTC_ORDER_FLOW_FEED_URL,
  now = Date.now(),
  timeoutMs = 2_500
} = {}) {
  if (!url) return { status: "UNAVAILABLE", reason: "BTC_ORDER_FLOW_FEED_URL is not configured" };
  if (typeof fetchImpl !== "function") return { status: "UNAVAILABLE", reason: "Fetch is unavailable" };
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("order-flow provider returned HTTP " + response.status);
    const payload = await response.json();
    const timestamp = number(payload.timestamp);
    const ageMs = now - timestamp;
    const valid = payload.symbol === "BTC-USD" && typeof payload.source === "string" && payload.source.length > 0 &&
      Number.isFinite(timestamp) && ageMs >= -2_000 && ageMs <= MAX_ORDER_FLOW_AGE_MS &&
      ["spot", "perpetual"].every(key => payload[key] && ["buyVolume", "sellVolume", "cvd"].every(field => finite(payload[key][field]))) &&
      finite(payload.perpetual.openInterestChangePct) && finite(payload.perpetual.fundingRate) &&
      number(payload.spot.buyVolume) >= 0 && number(payload.spot.sellVolume) >= 0 &&
      number(payload.perpetual.buyVolume) >= 0 && number(payload.perpetual.sellVolume) >= 0;
    if (!valid) throw new Error("order-flow payload is incomplete, stale, or invalid");
    return {
      status: "LIVE",
      symbol: payload.symbol,
      source: payload.source,
      timestamp,
      ageMs,
      spot: {
        buyVolume: number(payload.spot.buyVolume),
        sellVolume: number(payload.spot.sellVolume),
        cvd: number(payload.spot.cvd)
      },
      perpetual: {
        buyVolume: number(payload.perpetual.buyVolume),
        sellVolume: number(payload.perpetual.sellVolume),
        cvd: number(payload.perpetual.cvd),
        openInterestChangePct: number(payload.perpetual.openInterestChangePct),
        fundingRate: number(payload.perpetual.fundingRate)
      }
    };
  } catch (error) {
    return { status: "UNAVAILABLE", reason: error.name === "TimeoutError" ? "order-flow request timed out" : error.message };
  }
}

function aligned(value, direction) {
  return direction === "BUY" ? value > 0 : value < 0;
}

export function evaluateBtcSignalQuality({
  direction,
  frames,
  microstructure,
  orderFlow,
  quoteValidation,
  quote,
  plan,
  maxFundingRate = 0.001,
  maxEntryDistanceAtr = 0.75,
  maxSpreadAtr = 0.18
} = {}) {
  const blockers = [];
  const details = {};
  if (!["BUY", "SELL"].includes(direction)) {
    blockers.push("BTC candidate direction is not BUY or SELL");
    return { status: "BLOCKED", approved: false, blockers, details };
  }

  const { M5, M15, H1, H4 } = frames ?? {};
  const regime = direction === "BUY" ? "BULL_TREND" : "BEAR_TREND";
  for (const [name, frame] of [["H4", H4], ["H1", H1]]) {
    if (!frame || frame.regime !== regime) blockers.push("BTC " + name + " trend does not confirm " + direction);
  }

  const squeeze = H1?.squeeze;
  const squeezeAligned = squeeze?.state === "SQUEEZE_RELEASED" &&
    squeeze?.previousState === "SQUEEZE_ON" &&
    Number.isFinite(squeeze?.momentum) &&
    (direction === "BUY"
      ? squeeze.momentum > 0 && squeeze.direction === "BULLISH_STRENGTHENING"
      : squeeze.momentum < 0 && squeeze.direction === "BEARISH_STRENGTHENING");
  details.squeeze = {
    state: squeeze?.state ?? "UNAVAILABLE",
    previousState: squeeze?.previousState ?? "UNAVAILABLE",
    momentum: finite(squeeze?.momentum) ? number(squeeze.momentum) : null,
    direction: squeeze?.direction ?? "UNAVAILABLE"
  };
  if (!squeezeAligned) blockers.push("BTC H1 squeeze-release is not freshly confirmed and strengthening");

  const m15Candle = M15?.lastCandle;
  const m15Range = m15Candle && number(m15Candle.high) - number(m15Candle.low);
  const m15ClosePosition = m15Range > 0 ? (number(m15Candle.close) - number(m15Candle.low)) / m15Range : null;
  const m15Confirmed = m15Candle && (direction === "BUY"
    ? number(m15Candle.close) > number(m15Candle.open) && m15ClosePosition >= 0.65
    : number(m15Candle.close) < number(m15Candle.open) && m15ClosePosition <= 0.35);
  const structure = M5?.structure ?? {};
  const structureConfirmed = direction === "BUY"
    ? structure.bos === "BULLISH" || (structure.sweepConfirmed === true && structure.liquiditySweep === "BULLISH")
    : structure.bos === "BEARISH" || (structure.sweepConfirmed === true && structure.liquiditySweep === "BEARISH");
  details.priceStructure = { m15ClosePosition, m15Confirmed: Boolean(m15Confirmed), structureConfirmed };
  if (!m15Confirmed || !structureConfirmed) blockers.push("BTC M15 close and M5 BOS/liquidity reclaim do not confirm " + direction);

  const microLive = microstructure?.status === "LIVE";
  details.shortTermTape = {
    status: microstructure?.status ?? "UNAVAILABLE",
    direction: microstructure?.direction ?? "UNKNOWN",
    source: microstructure?.source ?? null
  };
  if (!microLive) blockers.push("BTC 10-second Coinbase tape is unavailable or stale");
  else if (microstructure.direction !== "NEUTRAL" && microstructure.direction !== direction) {
    blockers.push("BTC 10-second tape opposes " + direction);
  }

  const flowLive = orderFlow?.status === "LIVE" && orderFlow.symbol === "BTC-USD" &&
    Number.isFinite(orderFlow.timestamp) && orderFlow.ageMs >= 0 && orderFlow.ageMs <= MAX_ORDER_FLOW_AGE_MS;
  const spotAligned = flowLive && aligned(orderFlow.spot?.cvd, direction);
  const perpAligned = flowLive && aligned(orderFlow.perpetual?.cvd, direction);
  const oiExpanding = flowLive && orderFlow.perpetual.openInterestChangePct > 0;
  details.orderFlow = {
    status: orderFlow?.status ?? "UNAVAILABLE",
    source: orderFlow?.source ?? null,
    ageMs: orderFlow?.ageMs ?? null,
    spotCvd: flowLive ? orderFlow.spot.cvd : null,
    perpetualCvd: flowLive ? orderFlow.perpetual.cvd : null,
    openInterestChangePct: flowLive ? orderFlow.perpetual.openInterestChangePct : null,
    fundingRate: flowLive ? orderFlow.perpetual.fundingRate : null
  };
  if (!flowLive) blockers.push("BTC spot/futures order-flow evidence is unavailable or stale");
  else {
    if (!spotAligned) blockers.push("BTC spot CVD does not confirm " + direction);
    if (!perpAligned) blockers.push("BTC perpetual CVD does not confirm " + direction);
    if (!oiExpanding) blockers.push("BTC futures open interest is not expanding with the move");
    const funding = orderFlow.perpetual.fundingRate;
    if (Math.abs(funding) > maxFundingRate && aligned(funding, direction)) {
      blockers.push("BTC funding is crowded in the candidate direction");
    }
  }

  const atr = M5?.atr14;
  const spreadAtr = Number.isFinite(atr) && atr > 0 && Number.isFinite(quoteValidation?.spread)
    ? quoteValidation.spread / atr : null;
  const executablePrice = direction === "BUY" ? quote?.ask : quote?.bid;
  const entryDistanceAtr = Number.isFinite(atr) && atr > 0 && finite(executablePrice) && finite(M5?.close)
    ? Math.abs(number(executablePrice) - number(M5.close)) / atr : null;
  details.executionQuality = { spreadAtr, entryDistanceAtr, riskReward: plan?.riskRewardValue ?? plan?.riskReward ?? null };
  if (quoteValidation?.valid !== true) blockers.push("BTC executable bid/ask quote is not validated");
  if (spreadAtr === null || spreadAtr > maxSpreadAtr) blockers.push("BTC spread/ATR exceeds the approved limit or is unavailable");
  if (!plan || plan.entryTriggerConfirmed !== true) blockers.push("BTC M5 entry trigger is not confirmed");
  if (!Number.isFinite(Number(plan?.riskRewardValue ?? plan?.riskReward)) ||
      Number(plan.riskRewardValue ?? plan.riskReward) < 2) blockers.push("BTC trade plan does not meet minimum 1:2 risk/reward");
  if (entryDistanceAtr === null || entryDistanceAtr > maxEntryDistanceAtr) {
    blockers.push("BTC entry is too far from the last closed M5 price; reject chasing");
  }

  return {
    status: blockers.length ? "BLOCKED" : "PASS",
    approved: blockers.length === 0,
    direction,
    checkedAt: new Date().toISOString(),
    thresholds: { maxOrderFlowAgeMs: MAX_ORDER_FLOW_AGE_MS, maxFundingRate, maxEntryDistanceAtr, maxSpreadAtr },
    blockers,
    details
  };
}
