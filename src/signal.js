export function evaluateSignal({ M5: m5, M15: m15, H1: h1 }) {
  const structure = m5.structure ?? {};

  const bullishStructure =
    structure.bos === "BULLISH" ||
    structure.sweep === "BULLISH" ||
    (structure.sweepConfirmed &&
      structure.liquiditySweep === "BULLISH");

  const bearishStructure =
    structure.bos === "BEARISH" ||
    structure.sweep === "BEARISH" ||
    (structure.sweepConfirmed &&
      structure.liquiditySweep === "BEARISH");

  const bullish =
    m5.bullishVotes >= 3 &&
    m15.bullishVotes >= 3 &&
    h1.bullishVotes >= 2 &&
    h1.bearishVotes < 3;

  const bearish =
    m5.bearishVotes >= 3 &&
    m15.bearishVotes >= 3 &&
    h1.bearishVotes >= 2 &&
    h1.bullishVotes < 3;

  if (
    bullish &&
    bullishStructure &&
    Number.isFinite(m5.poc) &&
    m5.close > m5.poc
  ) return "BUY";

  if (
    bearish &&
    bearishStructure &&
    Number.isFinite(m5.poc) &&
    m5.close < m5.poc
  ) return "SELL";

  return "HOLD";
}

export function confirmSignal(signal, h1) {
  if (signal === "HOLD") {
    return { status: "NO TRADE" };
  }

  const squeeze = h1?.squeeze;

  if (
    !squeeze ||
    !Number.isFinite(squeeze.momentum) ||
    squeeze.state !== "SQUEEZE_RELEASED" ||
    squeeze.releasedNow !== true
  ) {
    return { status: "WAIT" };
  }

  if (
    signal === "BUY" &&
    !squeeze.direction?.startsWith("BULLISH")
  ) return { status: "WAIT" };

  if (
    signal === "SELL" &&
    !squeeze.direction?.startsWith("BEARISH")
  ) return { status: "WAIT" };

  return { status: "H1 ALIGNED" };
}
