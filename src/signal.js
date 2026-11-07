export function evaluateSignal({ M5, M15, H1 }) {
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
    M5.bullishVotes >= 3 &&
    M15.bullishVotes >= 3 &&
    H1.bullishVotes >= 2 &&
    H1.bearishVotes <= 2 &&
    bullishStructure &&
    (!Number.isFinite(M5.poc) || M5.close > M5.poc);

  const bearish =
    M5.bearishVotes >= 3 &&
    M15.bearishVotes >= 3 &&
    H1.bearishVotes >= 2 &&
    H1.bullishVotes <= 2 &&
    bearishStructure &&
    (!Number.isFinite(M5.poc) || M5.close < M5.poc);

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
