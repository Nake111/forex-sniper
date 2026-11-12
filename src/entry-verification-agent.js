const SPREAD_ATR_LIMITS = Object.freeze({ EURUSD: 0.12, BTCUSD: 0.18, XAUUSD: 0.15 });
const MAX_ENTRY_DEVIATION_ATR = Object.freeze({ EURUSD: 0.2, BTCUSD: 0.25, XAUUSD: 0.2 });

const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const unique = values => [...new Set(values.filter(Boolean))];

/**
 * Third, independent gate: verifies that a proposed paper entry is still
 * defensible against the latest validated bid/ask, not merely the candle close.
 * It does not place orders or verify a broker execution route.
 */
export function runEntryVerificationAgent({
  market, candidate, plan, quote, quoteValidation, entryAtr,
  marketReview, approval, dataStale = false, now = Date.now()
}) {
  const blockers = [];
  const limit = SPREAD_ATR_LIMITS[market];
  const maxDeviation = MAX_ENTRY_DEVIATION_ATR[market];

  if (!["EURUSD", "BTCUSD", "XAUUSD"].includes(market)) blockers.push("Unsupported market");
  if (!["BUY", "SELL"].includes(candidate)) blockers.push("No BUY/SELL candidate to verify");
  if (!approval?.approved || approval?.decision !== candidate) blockers.push("Independent signal approval agent did not approve this direction");
  if (!marketReview?.approved || marketReview?.direction !== candidate) blockers.push("market-intelligence agent did not independently confirm this direction");
  if (dataStale) blockers.push("One or more required candle timeframes are stale");
  if (!quoteValidation?.valid) blockers.push(quoteValidation?.reason ?? "Latest bid/ask quote is not valid");
  if (!quote?.snapshotId || quoteValidation?.snapshotId !== quote.snapshotId) blockers.push("Quote snapshot identity is missing or inconsistent");
  if (quote && quoteValidation && ["bid", "ask", "timestamp", "receivedAt", "source", "venue", "timestampQuality"].some(key => quoteValidation[key] !== quote[key])) {
    blockers.push("Quote values do not match the approved snapshot");
  }
  const quoteAgeAtApproval = Number.isFinite(quoteValidation?.ageMs) && Number.isFinite(quoteValidation?.checkedAt)
    ? quoteValidation.ageMs + Math.max(0, now - quoteValidation.checkedAt) : null;
  if (!quote || quote.timestampQuality !== "PROVIDER_TIMESTAMP" || quoteAgeAtApproval === null || quoteAgeAtApproval < 0 || quoteAgeAtApproval > 15_000) {
    blockers.push("Quote snapshot expired or lacks a fresh provider-supplied timestamp at approval");
  }
  if (!quote || !finite(quote.bid) || !finite(quote.ask) || Number(quote.bid) <= 0 || Number(quote.ask) <= Number(quote.bid)) {
    blockers.push("A positive, uncrossed live bid/ask pair is required");
  }
  if (!plan || !finite(plan.entry) || !finite(plan.stopLoss) || !finite(plan.takeProfit)) {
    blockers.push("Entry, stop-loss or take-profit is missing");
  }
  if (plan && plan.entryTriggerConfirmed !== true) blockers.push("Closed M5 entry trigger is not confirmed");
  if (plan && plan.direction && plan.direction !== candidate) blockers.push("Trade plan direction conflicts with candidate");

  let spread = null, spreadAtr = null, executablePrice = null, entryDeviationAtr = null, effectiveRiskReward = null;
  if (quote && finite(quote.bid) && finite(quote.ask) && Number(quote.ask) > Number(quote.bid)) {
    spread = Number(quote.ask) - Number(quote.bid);
    executablePrice = candidate === "BUY" ? Number(quote.ask) : candidate === "SELL" ? Number(quote.bid) : null;
  }
  if (spread !== null && finite(entryAtr) && Number(entryAtr) > 0) {
    spreadAtr = spread / Number(entryAtr);
    if (!Number.isFinite(limit) || spreadAtr > limit) {
      blockers.push("Spread/ATR " + spreadAtr.toFixed(4) + " exceeds " + market + " limit " + limit);
    }
  } else if (["EURUSD", "BTCUSD", "XAUUSD"].includes(market)) {
    blockers.push("Spread-to-ATR cannot be independently verified");
  }

  if (plan && executablePrice !== null && finite(plan.entry) && finite(entryAtr) && Number(entryAtr) > 0) {
    entryDeviationAtr = Math.abs(executablePrice - Number(plan.entry)) / Number(entryAtr);
    if (entryDeviationAtr > maxDeviation) {
      blockers.push("Executable-side quote is " + entryDeviationAtr.toFixed(3) + " ATR from planned entry; maximum is " + maxDeviation);
    }
  } else if (plan) {
    blockers.push("Executable entry distance from live bid/ask cannot be verified");
  }

  if (plan && executablePrice !== null && finite(plan.stopLoss) && finite(plan.takeProfit)) {
    const stop = Number(plan.stopLoss), target = Number(plan.takeProfit);
    const geometryValid = candidate === "BUY"
      ? stop < executablePrice && target > executablePrice
      : candidate === "SELL" ? stop > executablePrice && target < executablePrice : false;
    if (!geometryValid) blockers.push("Stop-loss and take-profit are not both on the correct sides of the current executable quote");
    const risk = Math.abs(executablePrice - stop);
    const reward = Math.abs(target - executablePrice);
    effectiveRiskReward = risk > 0 ? reward / risk : null;
    if (effectiveRiskReward === null || !Number.isFinite(effectiveRiskReward) || effectiveRiskReward < 2) {
      blockers.push("Live-quote risk/reward is below 1:2");
    }
  }

  const finalBlockers = unique(blockers);
  const approved = finalBlockers.length === 0;
  return {
    agent: "LIVE_ENTRY_VERIFICATION_AGENT",
    version: "1.0.0",
    market,
    decision: approved ? candidate : "NO APPROVED TRADE",
    approved,
    checkedAt: new Date(now).toISOString(),
    quoteValidationValid: quoteValidation?.valid === true,
    quoteAgeMs: Number.isFinite(Number(quoteValidation?.ageMs)) ? Number(quoteValidation.ageMs) : null,
    quote: quote ? { bid: quote.bid ?? null, ask: quote.ask ?? null, source: quote.source ?? null, venue: quote.venue ?? null } : null,
    executablePrice,
    spread,
    spreadAtr,
    entry: plan?.entry ?? null,
    entryDeviationAtr,
    stopLoss: plan?.stopLoss ?? null,
    takeProfit: plan?.takeProfit ?? null,
    effectiveRiskReward,
    blockers: finalBlockers,
    note: "Independent paper-entry verification only; no broker account, order routing, fill or slippage is verified."
  };
}
