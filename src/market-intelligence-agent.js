const directionOf = value => value === "BULLISH" || value === "BUY" ? "BUY"
  : value === "BEARISH" || value === "SELL" ? "SELL" : null;

function candlePressure(frame) {
  const candle = frame?.lastCandle;
  if (!candle) return { direction: "UNKNOWN", strength: 0, source: "unavailable" };
  const range = Number(candle.high) - Number(candle.low);
  if (!(range > 0)) return { direction: "NEUTRAL", strength: 0, source: "closed-candle location" };
  const closeLocation = (Number(candle.close) - Number(candle.low)) / range;
  const cvd = frame.cvd?.direction;
  const obv = frame.obv?.direction;
  const mfi = Number(frame.mfi14);
  let buy = 0, sell = 0;
  if (closeLocation >= 0.65) buy += 1;
  if (closeLocation <= 0.35) sell += 1;
  if (cvd === "BUYING") buy += 1;
  if (cvd === "SELLING") sell += 1;
  if (obv === "BUYING") buy += 1;
  if (obv === "SELLING") sell += 1;
  if (Number.isFinite(mfi) && mfi >= 55) buy += 1;
  if (Number.isFinite(mfi) && mfi <= 45) sell += 1;
  return {
    direction: buy > sell ? "BUY" : sell > buy ? "SELL" : "NEUTRAL",
    strength: Math.max(buy, sell),
    buyEvidence: buy,
    sellEvidence: sell,
    closeLocation: Number(closeLocation.toFixed(3)),
    source: "closed-candle location + CVD/OBV/MFI proxies (not exchange-wide executed volume)"
  };
}

function trendDirection(frame) {
  if (!frame) return null;
  if (frame.regime === "BULL_TREND" || frame.close > frame.ema50 && frame.ema20 > frame.ema50) return "BUY";
  if (frame.regime === "BEAR_TREND" || frame.close < frame.ema50 && frame.ema20 < frame.ema50) return "SELL";
  return null;
}

const SPREAD_ATR_LIMITS = { EURUSD: 0.12, BTCUSD: 0.18, XAUUSD: 0.15 };

function quoteSpreadReview(market, frames, quote) {
  const atr = Number(frames.M5?.atr14);
  const bid = Number(quote?.bid), ask = Number(quote?.ask);
  const suppliedSpread = Number(quote?.spread);
  const spread = Number.isFinite(bid) && Number.isFinite(ask) && ask > bid
    ? ask - bid : Number.isFinite(suppliedSpread) && suppliedSpread >= 0 ? suppliedSpread : null;
  const limit = SPREAD_ATR_LIMITS[market];
  const ratio = spread !== null && Number.isFinite(atr) && atr > 0 ? spread / atr : null;
  return {
    spread, atr: Number.isFinite(atr) ? atr : null, ratio, limit,
    valid: ratio !== null && Number.isFinite(limit) && ratio <= limit,
    blocker: ratio === null
      ? market + " spread/ATR cannot be verified from a valid quote and M5 ATR"
      : ratio > limit
        ? market + " spread/ATR " + ratio.toFixed(4) + " exceeds the " + limit.toFixed(2) + " limit"
        : null
  };
}

function eurUsdReview(frames, quote) {
  const spreadReview = quoteSpreadReview("EURUSD", frames, quote);
  const M5 = frames.M5 ?? {}, M15 = frames.M15 ?? {}, H1 = frames.H1 ?? {}, H4 = frames.H4 ?? {};
  const votes = [trendDirection(H4), trendDirection(H1), trendDirection(M15)].filter(Boolean);
  const buyVotes = votes.filter(v => v === "BUY").length;
  const sellVotes = votes.filter(v => v === "SELL").length;
  const alignedDirection = buyVotes >= 2 ? "BUY" : sellVotes >= 2 ? "SELL" : null;
  const candle = M5.lastCandle;
  const range = candle ? candle.high - candle.low : 0;
  const location = range > 0 ? (candle.close - candle.low) / range : null;
  const triggerDirection = candle && candle.close > candle.open && location >= 0.65 ? "BUY"
    : candle && candle.close < candle.open && location <= 0.35 ? "SELL" : null;
  const pressure = candlePressure(M5);
  const spreadAtr = spreadReview.ratio;
  const spreadAvailable = spreadReview.valid;
  const passed = alignedDirection !== null && triggerDirection === alignedDirection &&
    (pressure.direction === alignedDirection || pressure.strength < 2) && spreadAvailable;
  return {
    market: "EURUSD", direction: passed ? alignedDirection : alignedDirection,
    approved: passed,
    trend: { direction: alignedDirection ?? "MIXED", htfBuyVotes: buyVotes, htfSellVotes: sellVotes, frames: { M15: trendDirection(M15), H1: trendDirection(H1), H4: trendDirection(H4) } },
    m5: { triggerDirection, closeLocation: location, confirmed: triggerDirection !== null && triggerDirection === alignedDirection },
    orderFlow: pressure, spreadAtr, spread: spreadReview,
    blockers: [
      ...(alignedDirection ? [] : ["M15/H1/H4 do not provide a two-frame directional majority"]),
      ...(triggerDirection === alignedDirection && alignedDirection ? [] : ["M5 closed candle does not confirm the higher-timeframe direction"]),
      ...(pressure.direction !== alignedDirection && pressure.strength >= 2 ? ["M5 buyer/seller pressure proxy conflicts with trend"] : []),
      ...(spreadReview.blocker ? [spreadReview.blocker] : [])
    ]
  };
}

function btcUsdReview(frames, quote) {
  const spreadReview = quoteSpreadReview("BTCUSD", frames, quote);
  const H1 = frames.H1 ?? {}, M15 = frames.M15 ?? {};
  const squeeze = H1.squeeze ?? {};
  const previousState = squeeze.previousState ?? null;
  const released = squeeze.state === "SQUEEZE_RELEASED" ||
    (previousState === "SQUEEZE_ON" && squeeze.state === "NO_SQUEEZE");
  const noActiveSqueeze = squeeze.state === "NO_SQUEEZE" && previousState === "NO_SQUEEZE";
  const squeezeStateKnown = ["SQUEEZE_ON", "SQUEEZE_RELEASED", "NO_SQUEEZE"].includes(squeeze.state);
  const momentum = Number(squeeze.momentum);
  const squeezeDirection = String(squeeze.direction ?? "");
  const direction = Number.isFinite(momentum) && momentum > 0 && squeezeDirection === "BULLISH_STRENGTHENING" ? "BUY"
    : Number.isFinite(momentum) && momentum < 0 && squeezeDirection === "BEARISH_STRENGTHENING" ? "SELL" : null;
  const h1Trend = trendDirection(H1);
  const pressure = candlePressure(M15);
  const confirmed = squeezeStateKnown && released && direction !== null &&
    h1Trend === direction && (pressure.direction === direction || pressure.strength < 2) &&
    spreadReview.valid;
  const blockers = [];
  if (squeeze.state === "SQUEEZE_ON") blockers.push("H1 volatility squeeze is still active; wait for a closed-bar release");
  if (!squeezeStateKnown) blockers.push("H1 squeeze state is unavailable; fail-closed until valid H1 squeeze data arrives");
  else if (!released) blockers.push("H1 squeeze release is not confirmed by the latest closed H1 candle");
  if (!direction) blockers.push("H1 squeeze momentum is not strengthening in a clear direction");
  if (direction && h1Trend !== direction) blockers.push("H1 EMA/regime trend does not agree with squeeze momentum");
  if (direction && pressure.direction !== direction && pressure.strength >= 2) blockers.push("M15 buyer/seller pressure proxy conflicts with H1 release");
  if (spreadReview.blocker) blockers.push(spreadReview.blocker);
  return {
    market: "BTCUSD", direction, approved: confirmed,
    squeeze: { state: squeeze.state ?? "UNKNOWN", previousState, stateKnown: squeezeStateKnown, momentum: Number.isFinite(momentum) ? momentum : null, direction: squeeze.direction ?? "UNKNOWN", released, noActiveSqueeze, h1Trend },
    orderFlow: pressure, spread: spreadReview, blockers
  };
}

function goldEventRisk(macro, now) {
  const calendar = macro.calendar ?? {};
  const risk = calendar.risk ?? {};
  const active = Array.isArray(risk.activeEvents) ? risk.activeEvents : [];
  const upcoming = Array.isArray(risk.nextEvents) ? risk.nextEvents : [];
  const highActive = active.filter(e => String(e.impact).toUpperCase() === "HIGH");
  const mediumActive = active.filter(e => String(e.impact).toUpperCase() === "MEDIUM");
  const verifiedUpcomingHigh = upcoming.filter(e => String(e.impact).toUpperCase() === "HIGH" &&
    Number.isFinite(Date.parse(e.scheduledAt ?? "")) && Date.parse(e.scheduledAt) > now);
  const primaryUpcomingLock = verifiedUpcomingHigh.filter(e => Date.parse(e.scheduledAt) - now <= 30 * 60_000);
  const headlines = Array.isArray(macro.headlines) ? macro.headlines : [];
  const recentHeadlineRisk = headlines.filter(item => {
    const t = Date.parse(item.date ?? "");
    return Number.isFinite(t) && now - t >= 0 && now - t <= 90 * 60_000;
  });
  const officialEvents = Array.isArray(macro.goldMacro?.calendar?.events) ? macro.goldMacro.calendar.events : [];
  const officialTimed = officialEvents.map(event => ({
    name: event.name,
    timestamp: Number(event.timestamp ?? Date.parse(event.scheduledAt ?? ""))
  })).filter(event => Number.isFinite(event.timestamp));
  const officialActive = officialTimed.filter(event => now >= event.timestamp && now - event.timestamp <= 30 * 60_000);
  const officialUpcomingLock = officialTimed.filter(event => event.timestamp > now && event.timestamp - now <= 30 * 60_000);
  const officialUpcoming = officialTimed.filter(event => event.timestamp - now > 30 * 60_000 && event.timestamp - now <= 24 * 60 * 60_000);
  let status = "NORMAL";
  let reason = "No active or imminent high-impact event in the verified release protection window.";
  if (calendar.status !== "AVAILABLE" || risk.status === "UNKNOWN" || risk.status === "STALE_SOURCE_DATA" || risk.status === "UNKNOWN_TIME_HIGH_IMPACT") {
    status = "UNKNOWN";
    reason = "Calendar unavailable, stale, or a high-impact event has no verified release time.";
  } else if (highActive.length || officialActive.length) {
    status = "HIGH";
    reason = "A high-impact release is active or inside its post-release protection window.";
  } else if (officialUpcomingLock.length || primaryUpcomingLock.length) {
    status = "UPCOMING_HIGH";
    reason = "A verified high-impact release from the primary or secondary calendar is approaching within 30 minutes; pre-release entries are locked.";
  } else if (mediumActive.length) {
    status = "MEDIUM";
    reason = "A medium-impact event is inside the active protection window.";
  } else if (recentHeadlineRisk.length) {
    status = "HEADLINE_CAUTION";
    reason = "Recent high-impact headlines require volatility review; no active scheduled event is identified.";
  }
  return {
    status, reason,
    secondaryCalendarStatus: macro.goldMacro?.calendar?.unavailable ? "UNAVAILABLE — primary ShowMyTrades calendar still evaluated" : "AVAILABLE",
    secondaryCalendarWarning: macro.goldMacro?.calendar?.unavailable ?? null,
    activeHighImpactEvents: [
      ...highActive.map(e => ({ name: e.name, scheduledAt: e.scheduledAt, impact: e.impact })),
      ...officialActive.map(e => ({ name: e.name, scheduledAt: new Date(e.timestamp).toISOString(), impact: "HIGH" }))
    ],
    activeMediumImpactEvents: mediumActive.map(e => ({ name: e.name, scheduledAt: e.scheduledAt, impact: e.impact })),
    upcomingHighImpactEvents: [
      ...verifiedUpcomingHigh.map(e => ({ name: e.name, scheduledAt: e.scheduledAt, impact: e.impact, withinProtectionWindow: primaryUpcomingLock.includes(e) })),
      ...officialUpcomingLock.map(e => ({ name: e.name, scheduledAt: new Date(e.timestamp).toISOString(), impact: "HIGH", withinProtectionWindow: true })),
      ...officialUpcoming.map(e => ({ name: e.name, scheduledAt: new Date(e.timestamp).toISOString(), impact: "HIGH", withinProtectionWindow: false }))
    ],
    recentHighImpactHeadlines: recentHeadlineRisk.map(e => ({ title: e.title, date: e.date })),
    upcomingEventIsActive: officialUpcomingLock.length > 0 || primaryUpcomingLock.length > 0,
    blocksNewEntry: ["HIGH", "UPCOMING_HIGH", "MEDIUM", "UNKNOWN", "HEADLINE_CAUTION"].includes(status)
  };
}

function goldReview(frames, macro, now, quote) {
  const spreadReview = quoteSpreadReview("XAUUSD", frames, quote);
  const risk = goldEventRisk(macro, now);
  const H1 = frames.H1 ?? {};
  const atrRatio = Number.isFinite(H1.atr14) && Number.isFinite(H1.atrBaseline) && H1.atrBaseline > 0
    ? H1.atr14 / H1.atrBaseline : null;
  const volatilityElevated = atrRatio !== null && atrRatio >= 1.5;
  if (risk.status === "HEADLINE_CAUTION" && atrRatio !== null && !volatilityElevated &&
      macro.calendar?.status === "AVAILABLE" && macro.calendar?.risk?.status === "NORMAL") {
    risk.blocksNewEntry = false;
    risk.reason = "Recent high-impact headlines are present, but the primary economic calendar is verified and H1 ATR ratio is below 1.5; secondary-calendar outage is disclosed but does not independently veto the setup.";
  } else if (risk.status === "HEADLINE_CAUTION") {
    risk.blocksNewEntry = true;
    const volatilityReason = atrRatio === null
      ? "H1 volatility ratio is unavailable"
      : volatilityElevated
        ? "elevated H1 volatility (ATR14/baseline " + atrRatio.toFixed(2) + ")"
        : "H1 ATR14/baseline is " + atrRatio.toFixed(2) + " (below threshold)";
    const calendarReason = risk.secondaryCalendarWarning ? "; secondary calendar is unavailable" : "";
    risk.reason = "Recent high-impact headlines require caution; " + volatilityReason + calendarReason + "; risk veto remains active until both checks are clear.";
  }
  risk.volatility = { h1Atr14: H1.atr14 ?? null, h1AtrBaseline: H1.atrBaseline ?? null, atrRatio, elevated: volatilityElevated, threshold: 1.5 };
  const M15 = frames.M15 ?? {}, M5 = frames.M5 ?? {};
  const h1 = trendDirection(H1), m15 = trendDirection(M15);
  const candle = M5.lastCandle;
  const range = candle ? candle.high - candle.low : 0;
  const loc = range > 0 ? (candle.close - candle.low) / range : null;
  const trigger = candle && candle.close > candle.open && loc >= 0.65 ? "BUY"
    : candle && candle.close < candle.open && loc <= 0.35 ? "SELL" : null;
  const direction = h1 && h1 === m15 ? h1 : null;
  const pressure = candlePressure(M5);
  const approved = direction !== null && trigger === direction &&
    !risk.blocksNewEntry && (pressure.direction === direction || pressure.strength < 2) &&
    spreadReview.valid;
  return {
    market: "XAUUSD", direction, approved, eventRisk: risk, spread: spreadReview,
    m5: { triggerDirection: trigger, closeLocation: loc, confirmed: trigger === direction && direction !== null },
    orderFlow: pressure,
    blockers: [
      ...(risk.blocksNewEntry ? [risk.reason] : []),
      ...(direction ? [] : ["Gold H1 and M15 trend do not align"]),
      ...(trigger === direction && direction ? [] : ["Gold M5 trigger candle does not confirm H1/M15 direction"]),
      ...(pressure.direction !== direction && pressure.strength >= 2 ? ["Gold buyer/seller pressure proxy conflicts with trend"] : []),
      ...(spreadReview.blocker ? [spreadReview.blocker] : [])
    ]
  };
}

export function runMarketIntelligenceAgent({ market, frames, macro = {}, quote = null, now = Date.now() }) {
  if (!frames || !frames.M5 || !frames.H1) return {
    agent: "MARKET_INTELLIGENCE_AGENT", market, approved: false,
    direction: null, blockers: ["Required M5/H1 frames are unavailable"]
  };
  let review;
  if (market === "EURUSD") review = eurUsdReview(frames, quote);
  else if (market === "BTCUSD") review = btcUsdReview(frames, quote);
  else if (market === "XAUUSD") review = goldReview(frames, macro, now, quote);
  else review = { market, approved: false, direction: null, blockers: ["Unsupported market"] };
  return {
    agent: "MARKET_INTELLIGENCE_AGENT",
    version: "1.0.0",
    ...review,
    note: "Buyer/seller pressure is inferred from available candle and tick-volume proxies. Best bid/ask alone is not full order-book depth or verified executed buy/sell volume."
  };
}
