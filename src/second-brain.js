import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

const finite = Number.isFinite;
const round = (value, digits = 8) => finite(value) ? Number(value.toFixed(digits)) : null;

async function readEvents(path) {
  try {
    const raw = await readFile(path, "utf8");
    return raw.split("\n").filter(Boolean).map((line, index) => {
      try { return JSON.parse(line); }
      catch { throw new Error(`Paper journal has invalid JSON at line ${index + 1}; refusing to overwrite evidence`); }
    });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function candleTime(candle) {
  const raw = candle.timestamp ?? candle.time ?? candle.date;
  const value = typeof raw === "number" ? raw : Date.parse(raw);
  return finite(value) ? (value < 1e12 ? value * 1000 : value) : NaN;
}

function estimateCost(market, midpoint) {
  const suffix = market.toUpperCase();
  const defaults = { EURUSD: 0.1, BTCUSD: 2, XAUUSD: 2 };
  const slippageBpsRaw = process.env[`PAPER_ESTIMATED_SLIPPAGE_BPS_${suffix}`];
  const commissionBpsRaw = process.env[`PAPER_ESTIMATED_COMMISSION_BPS_${suffix}`];
  const slippageBps = slippageBpsRaw === undefined ? defaults[suffix] ?? null : Number(slippageBpsRaw);
  const commissionBps = commissionBpsRaw === undefined ? null : Number(commissionBpsRaw);
  const validSlip = finite(slippageBps) && slippageBps >= 0 ? slippageBps : null;
  const validCommission = finite(commissionBps) && commissionBps >= 0 ? commissionBps : null;
  return {
    estimatedSlippageBpsPerSide: validSlip,
    estimatedSlippagePricePerSide: validSlip !== null && finite(midpoint) ? round(midpoint * validSlip / 10000) : null,
    estimatedCommissionBpsRoundTrip: validCommission,
    estimatedCommissionPriceRoundTrip: validCommission !== null && finite(midpoint) ? round(midpoint * validCommission / 10000) : null,
    observedSlippage: null,
    executionFill: null,
    actualCommission: null,
    note: "Default slippage assumptions per side: EURUSD 0.1 bps, BTCUSD 2 bps, XAUUSD 2 bps; override with PAPER_ESTIMATED_SLIPPAGE_BPS_<MARKET>. Estimated only, not observed fills. Commission is null unless configured."
  };
}

/**
 * Append-only paper research journal. Signal and outcome events are immutable:
 * later candle resolution is recorded as a separate event, never by rewriting
 * historical evidence. No orders are placed.
 */
export async function updateSecondBrain({
  market, candles = [], signal = "NO TRADE", candidate = "HOLD", plan = null,
  quote = null, quoteValidation = {}, vwap = {}, agents = {}, llm = {},
  macro = {}, frames = {}, marketIntelligence = {}, approval = {},
  verification = {}, decisionLayers = {}, strategyAttribution = {},
  path = process.env.PAPER_JOURNAL_PATH ?? "data/second-brain.jsonl",
  now = Date.now()
}) {
  const events = await readEvents(path);
  const validCandles = candles.filter(c =>
    [c.open, c.high, c.low, c.close].every(v => finite(Number(v))) &&
    finite(candleTime(c))
  ).sort((a, b) => candleTime(a) - candleTime(b));
  const signals = new Map();
  const resolved = new Set();
  const eventIds = new Set();

  for (const event of events) {
    if (event.eventId) eventIds.add(event.eventId);
    if (event.eventType === "PAPER_SIGNAL") signals.set(event.signalId, event);
    // Backward compatibility for the original v1 mutable journal records.
    if (event.kind === "SIGNAL" && event.key) signals.set(event.key, {
      ...event, signalId: event.key, signalCandleAt: event.candleAt ?? event.createdAt,
      side: event.side, stopLoss: event.stopLoss, takeProfit: event.takeProfit
    });
    if (event.eventType === "PAPER_OUTCOME" && event.signalId) resolved.add(event.signalId);
  }

  const newEvents = [];
  for (const [signalId, record] of signals) {
    if (resolved.has(signalId) || record.market !== market) continue;
    for (const candle of validCandles) {
      const at = candleTime(candle);
      if (at <= Number(record.signalCandleAt ?? record.createdAt)) continue;
      const high = Number(candle.high), low = Number(candle.low);
      const stopHit = record.side === "BUY" ? low <= record.stopLoss : high >= record.stopLoss;
      const targetHit = record.side === "BUY" ? high >= record.takeProfit : low <= record.takeProfit;
      const ambiguous = stopHit && targetHit;
      const barsSinceSignal = validCandles.filter(item => candleTime(item) > Number(record.signalCandleAt ?? record.createdAt) && candleTime(item) <= at).length;
      const timedOut = !stopHit && !targetHit && barsSinceSignal >= 180;
      if (!stopHit && !targetHit && !timedOut) continue;
      const outcome = ambiguous ? "AMBIGUOUS" : targetHit ? "WIN" : stopHit ? "LOSS" : "TIMEOUT";
      const resolutionPrice = ambiguous ? null : targetHit ? record.takeProfit : stopHit ? record.stopLoss : Number(candle.close);
      const entry = Number(record.indicativeEntry);
      const stop = Number(record.stopLoss);
      const riskDistance = Math.abs(entry - stop);
      const grossR = !ambiguous && finite(entry) && finite(stop) && riskDistance > 0
        ? (record.side === "BUY" ? resolutionPrice - entry : entry - resolutionPrice) / riskDistance
        : null;
      const spreadAndSlippageBps = record.quoteEvidence?.costs?.estimatedSpreadAndSlippageBps;
      const commissionBps = record.quoteEvidence?.costs?.estimatedCommissionBpsRoundTrip;
      const midpoint = Number(record.quoteEvidence?.midpoint);
      const spreadAndSlippagePrice = finite(spreadAndSlippageBps) && spreadAndSlippageBps >= 0 && finite(midpoint) && midpoint > 0
        ? midpoint * spreadAndSlippageBps / 10_000 : null;
      const commissionPrice = finite(commissionBps) && commissionBps >= 0 && finite(midpoint) && midpoint > 0
        ? midpoint * commissionBps / 10_000 : null;
      const spreadAndSlippageR = spreadAndSlippagePrice !== null && riskDistance > 0
        ? spreadAndSlippagePrice / riskDistance : null;
      const commissionR = commissionPrice !== null && riskDistance > 0
        ? commissionPrice / riskDistance : null;
      const allInCostPrice = spreadAndSlippagePrice !== null && commissionPrice !== null
        ? spreadAndSlippagePrice + commissionPrice : null;
      const allInCostR = spreadAndSlippageR !== null && commissionR !== null
        ? spreadAndSlippageR + commissionR : null;
      newEvents.push({
        eventId: `OUTCOME:${signalId}`, eventType: "PAPER_OUTCOME",
        signalId, market, outcome, strategy: record.strategy ?? {},
        resolvedAt: at, resolutionPrice, barsHeld: barsSinceSignal,
        grossR: round(grossR, 4),
        estimatedSpreadAndSlippageCostPrice: round(spreadAndSlippagePrice),
        estimatedSpreadAndSlippageCostR: round(spreadAndSlippageR, 4),
        estimatedCommissionCostPrice: round(commissionPrice),
        estimatedCommissionCostR: round(commissionR, 4),
        estimatedAllInCostPrice: round(allInCostPrice),
        estimatedAllInCostR: round(allInCostR, 4),
        netEstimatedRExcludingCommission: grossR !== null && spreadAndSlippageR !== null
          ? round(grossR - spreadAndSlippageR, 4) : null,
        netEstimatedR: grossR !== null && allInCostR !== null ? round(grossR - allInCostR, 4) : null,
        estimatedCostMethod: "Signal-time observed spread plus configured estimated two-sided slippage; commission kept separate and all-in cost remains unavailable until commission is configured",
        resolutionMethod: "Subsequent closed-candle high/low proxy; ambiguous when both stop and target touch in the same candle",
        rCalculationMethod: "Indicative plan entry and stop distance; not an actual fill",
        actualFill: null, observedSlippage: null, actualCommission: null
      });
      resolved.add(signalId);
      break;
    }
  }

  const latest = validCandles.at(-1);
  const candleAt = latest ? candleTime(latest) : null;
  const quoteTimestamp = finite(quote?.timestamp) ? quote.timestamp : null;
  const quoteReceivedAt = finite(quote?.receivedAt) ? quote.receivedAt : null;
  const midpoint = finite(quote?.bid) && finite(quote?.ask) ? (quote.bid + quote.ask) / 2 : null;
  const observedSpread = finite(quoteValidation?.spread) ? quoteValidation.spread :
    finite(quote?.bid) && finite(quote?.ask) ? quote.ask - quote.bid : null;
  const spreadAtr = finite(observedSpread) && finite(frames?.M5?.atr14) && frames.M5.atr14 > 0
    ? observedSpread / frames.M5.atr14 : null;
  const quoteAgeMs = finite(quoteTimestamp) ? Math.max(0, now - quoteTimestamp) : null;
  const costEstimate = estimateCost(market, midpoint);
  const observedSpreadBps = finite(observedSpread) && finite(midpoint) && midpoint > 0
    ? observedSpread / midpoint * 10000 : null;
  costEstimate.observedSpreadBps = round(observedSpreadBps, 4);
  costEstimate.estimatedSpreadAndSlippageBps = finite(observedSpreadBps) &&
    finite(costEstimate.estimatedSlippageBpsPerSide)
    ? round(observedSpreadBps + 2 * costEstimate.estimatedSlippageBpsPerSide, 4) : null;
  costEstimate.commissionIncludedInRoundTripEstimate = finite(costEstimate.estimatedCommissionBpsRoundTrip);
  costEstimate.estimatedRoundTripCostBps = costEstimate.commissionIncludedInRoundTripEstimate &&
    finite(costEstimate.estimatedSpreadAndSlippageBps)
    ? round(costEstimate.estimatedSpreadAndSlippageBps + costEstimate.estimatedCommissionBpsRoundTrip, 4) : null;
  const quoteEvidence = {
    provider: quote?.source ?? null, venue: quote?.venue ?? null,
    bid: round(quote?.bid), ask: round(quote?.ask), midpoint: round(midpoint),
    observedSpread: round(observedSpread), observedSpreadBps: round(observedSpreadBps, 4),
    quoteTimestamp, receivedAt: quoteReceivedAt, quoteAgeMs,
    timestampQuality: quote?.timestampQuality ?? null,
    validation: quoteValidation?.valid === true ? "VALID" : "INVALID_OR_UNAVAILABLE",
    validationReason: quoteValidation?.reason ?? null, spreadAtr: round(spreadAtr, 6),
    costs: costEstimate
  };

  const observationId = `OBS:${market}:${candleAt ?? "NO_CANDLE"}:${quoteTimestamp ?? "NO_QUOTE"}`;
  if (!eventIds.has(observationId)) {
    newEvents.push({
      eventId: observationId, eventType: "PAPER_OBSERVATION", market,
      observedAt: now, candleAt, close: latest ? Number(latest.close) : null,
      candidateDirection: ["BUY", "SELL"].includes(candidate) ? candidate : "NONE",
      decision: signal, quoteEvidence,
      gateEvidence: {
        marketIntelligence: { approved: marketIntelligence.approved === true, blockers: marketIntelligence.blockers ?? [] },
        approval: { decision: approval.decision ?? "UNKNOWN", approved: approval.approved === true, blockers: approval.blockers ?? [] },
        verification: { decision: verification.decision ?? "UNKNOWN", approved: verification.approved === true, blockers: verification.blockers ?? [] },
        discovery: decisionLayers.discovery?.candidate ?? null,
        verificationLayer: decisionLayers.verification?.status ?? null,
        executionLayer: decisionLayers.execution?.decision ?? null
      },
      macroRisk: macro.eventRisk ?? "UNKNOWN",
      timeframes: Object.fromEntries(["M5", "M15", "H1", "H4"].map(key => {
        const frame = frames[key] ?? {};
        return [key, { close: frame.close ?? null, rsi14: frame.rsi14 ?? null,
          adx14: frame.adx14 ?? null, regime: frame.regime ?? "UNKNOWN" }];
      }))
    });
  }

  if (["BUY", "SELL"].includes(signal) && plan && finite(candleAt)) {
    const signalId = `SIGNAL:${market}:${signal}:${candleAt}`;
    if (!eventIds.has(signalId) && !signals.has(signalId)) {
      newEvents.push({
        eventId: signalId, eventType: "PAPER_SIGNAL", signalId, market, side: signal,
        createdAt: now, signalCandleAt: candleAt,
        indicativeEntry: finite(plan.entry) ? plan.entry : null,
        stopLoss: finite(plan.stopLoss) ? plan.stopLoss : null,
        takeProfit: finite(plan.takeProfit) ? plan.takeProfit : null,
        riskReward: finite(plan.riskReward) ? plan.riskReward : null,
        quoteEvidence, outcome: "PENDING",
        outcomeMethod: "Subsequent closed-candle high/low proxy; 180 M5 bars maximum; timeout marked at closing price; not a broker fill",
        strategy: { ...strategyAttribution }
      });
    }
  }

  if (newEvents.length) {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, newEvents.map(event => JSON.stringify(event)).join("\n") + "\n", { encoding: "utf8", flag: "a" });
  }

  const allEvents = [...events, ...newEvents];
  const marketSignals = allEvents.filter(event => event.eventType === "PAPER_SIGNAL" && event.market === market);
  const marketOutcomes = allEvents.filter(event => event.eventType === "PAPER_OUTCOME" && event.market === market);
  const wins = marketOutcomes.filter(event => event.outcome === "WIN").length;
  const losses = marketOutcomes.filter(event => event.outcome === "LOSS").length;
  return {
    stored: true, appendOnly: true, path, appendedEvents: newEvents.length,
    marketSignals: marketSignals.length, resolved: wins + losses,
    wins, losses, pending: Math.max(0, marketSignals.length - marketOutcomes.length),
    ambiguous: marketOutcomes.filter(event => event.outcome === "AMBIGUOUS").length,
    timeouts: marketOutcomes.filter(event => event.outcome === "TIMEOUT").length,
    winRatePct: wins + losses ? Number((wins / (wins + losses) * 100).toFixed(1)) : null,
    quoteEvidence
  };
}
