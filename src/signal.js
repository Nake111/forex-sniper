export const SIGNAL_PROFILES = {
  baseline: {
    minM5Votes: 3,
    minM15Votes: 3,
    minH1Votes: 2,
    maxOpposingH1Votes: 2,
    minBullishRsi: 50,
    maxBearishRsi: 50
  },
  strict: {
    minM5Votes: 3,
    minM15Votes: 3,
    minH1Votes: 3,
    maxOpposingH1Votes: 1,
    minBullishRsi: 55,
    maxBearishRsi: 45
  },
  advanced: {
    minM5Votes: 3,
    minM15Votes: 3,
    minH1Votes: 3,
    maxOpposingH1Votes: 1,
    minBullishRsi: 55,
    maxBearishRsi: 45,
    requireVwapCvd: true,
    minM5Adx: 18,
    minM15Adx: 18
  }
};

export function evaluateSignal({ M5, M15, H1 }, profile = "baseline") {
  const rules = typeof profile === "string"
    ? SIGNAL_PROFILES[profile]
    : profile;
  if (!rules) throw new Error(`Unknown signal profile: ${profile}`);
  const structure = M5?.structure ?? {};
  const bullishStructure =
    structure.bos === "BULLISH" ||
    structure.sweep === "BULLISH" ||
    (structure.sweepConfirmed && structure.liquiditySweep === "BULLISH");
  const bearishStructure =
    structure.bos === "BEARISH" ||
    structure.sweep === "BEARISH" ||
    (structure.sweepConfirmed && structure.liquiditySweep === "BEARISH");

  const valid = [M5, M15, H1].every(frame =>
    frame &&
    Number.isFinite(frame.close) &&
    Number.isFinite(frame.ema20) &&
    Number.isFinite(frame.ema50) &&
    Number.isFinite(frame.rsi14) &&
    Number.isFinite(frame.macd) &&
    Number.isFinite(frame.macdSignal)
  );
  if (!valid) return "HOLD";

  const bullish =
    M5.bullishVotes >= rules.minM5Votes &&
    M15.bullishVotes >= rules.minM15Votes &&
    H1.bullishVotes >= rules.minH1Votes &&
    H1.bearishVotes <= rules.maxOpposingH1Votes &&
    M5.rsi14 >= rules.minBullishRsi &&
    bullishStructure &&
    (!Number.isFinite(M5.poc) || M5.close > M5.poc) &&
    (!Number.isFinite(rules.minM5Adx) || (Number.isFinite(M5.adx14) && M5.adx14 >= rules.minM5Adx)) &&
    (!Number.isFinite(rules.minM15Adx) || (Number.isFinite(M15.adx14) && M15.adx14 >= rules.minM15Adx)) &&
    (!rules.requireVwapCvd || (Number.isFinite(M5.vwap) && M5.close > M5.vwap && M5.cvd?.direction === "BUYING" && M5.cvd?.slope > 0));

  const bearish =
    M5.bearishVotes >= rules.minM5Votes &&
    M15.bearishVotes >= rules.minM15Votes &&
    H1.bearishVotes >= rules.minH1Votes &&
    H1.bullishVotes <= rules.maxOpposingH1Votes &&
    M5.rsi14 <= rules.maxBearishRsi &&
    bearishStructure &&
    (!Number.isFinite(M5.poc) || M5.close < M5.poc) &&
    (!Number.isFinite(rules.minM5Adx) || (Number.isFinite(M5.adx14) && M5.adx14 >= rules.minM5Adx)) &&
    (!Number.isFinite(rules.minM15Adx) || (Number.isFinite(M15.adx14) && M15.adx14 >= rules.minM15Adx)) &&
    (!rules.requireVwapCvd || (Number.isFinite(M5.vwap) && M5.close < M5.vwap && M5.cvd?.direction === "SELLING" && M5.cvd?.slope < 0));

  if (bullish && !bearish) return "BUY";
  if (bearish && !bullish) return "SELL";
  return "HOLD";
}

export function confirmSignal(signal, H1) {
  if (signal === "HOLD") return { status: "NO TRADE" };

  const squeeze = H1?.squeeze;
  if (!squeeze || !Number.isFinite(squeeze.momentum)) {
    return { status: "WAIT", reason: "Missing H1 momentum confirmation" };
  }

  if (squeeze.state === "SQUEEZE_ON") {
    return { status: "WAIT", reason: "H1 volatility squeeze is still active" };
  }

  const aligned = signal === "BUY"
    ? squeeze.momentum > 0 && squeeze.direction?.startsWith("BULLISH")
    : squeeze.momentum < 0 && squeeze.direction?.startsWith("BEARISH");

  return aligned
    ? { status: "H1 ALIGNED" }
    : { status: "WAIT", reason: "H1 momentum does not confirm direction" };
}
