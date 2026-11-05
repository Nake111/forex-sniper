
import { readFile } from "node:fs/promises";
import { analyseTimeframe } from "./market.js";
import { getForexNews } from "./news.js";

const DATA_FILES = {
  M5: "data/eurusd-m5.json",
  M15: "data/eurusd-m15.json",
  H1: "data/eurusd-h1.json"
};

const RULES = {
  M5: 3,
  M15: 3,
  H1: 2,
  H1_STRONG_OPPOSITION: 3
};

function price(value) {
  return Number.isFinite(value) ? value.toFixed(5) : "N/A";
}

async function loadCandles(timeframe) {
  const filename = DATA_FILES[timeframe];
  const raw = await readFile(filename, "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`${timeframe}: candle file is not an array.`);
  }

  const candles = parsed
    .map(c => ({
      time: c.timestamp,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume ?? 0)
    }))
    .filter(c =>
      [c.open, c.high, c.low, c.close].every(Number.isFinite)
    );

  if (candles.length < 60) {
    throw new Error(
      `${timeframe}: only ${candles.length} valid candles found.`
    );
  }

  const volumeCandles = candles.filter(c =>
    Number.isFinite(c.volume) && c.volume > 0
  ).length;

  console.log(
    `${timeframe}: ${candles.length} candles loaded; ` +
    `${volumeCandles} candles contain volume.`
  );

  return candles;
}

function printTimeframe(name, result) {
  console.log(`\n========== ${name} ==========`);
  console.log(`Close:       ${price(result.close)}`);
  console.log(`EMA20:       ${price(result.ema20)}`);
  console.log(`EMA50:       ${price(result.ema50)}`);
  console.log(`RSI14:       ${result.rsi14.toFixed(2)}`);
  console.log(`MACD:        ${result.macd.toFixed(7)}`);
  console.log(`MACD Signal: ${result.macdSignal.toFixed(7)}`);
  console.log(`ATR14:       ${price(result.atr14)}`);
  console.log(`Volume POC:  ${price(result.poc)}`);
  console.log(`Bullish:     ${result.bullishVotes}/4`);
  console.log(`Bearish:     ${result.bearishVotes}/4`);
  console.log(`BOS:         ${result.structure.bos}`);
  console.log(`Sweep:       ${result.structure.sweep}`);
}

function evaluate(m5, m15, h1) {
  const reasons = [];

  const buyM5 = m5.bullishVotes >= RULES.M5;
  const buyM15 = m15.bullishVotes >= RULES.M15;
  const buyH1 = h1.bullishVotes >= RULES.H1;
  const h1BlocksBuy =
    h1.bearishVotes >= RULES.H1_STRONG_OPPOSITION;

  const sellM5 = m5.bearishVotes >= RULES.M5;
  const sellM15 = m15.bearishVotes >= RULES.M15;
  const sellH1 = h1.bearishVotes >= RULES.H1;
  const h1BlocksSell =
    h1.bullishVotes >= RULES.H1_STRONG_OPPOSITION;

  const buyStructure =
    m5.structure.bos === "BULLISH" ||
    m5.structure.sweep === "BULLISH";

  const sellStructure =
    m5.structure.bos === "BEARISH" ||
    m5.structure.sweep === "BEARISH";

  const pocAvailable = Number.isFinite(m5.poc);

  const buyVolume = pocAvailable && m5.close > m5.poc;
  const sellVolume = pocAvailable && m5.close < m5.poc;

  const buySetup =
    buyM5 && buyM15 && buyH1 && !h1BlocksBuy;

  const sellSetup =
    sellM5 && sellM15 && sellH1 && !h1BlocksSell;

  let signal = "HOLD";

  if (buySetup && buyStructure && buyVolume) {
    signal = "BUY";
  } else if (sellSetup && sellStructure && sellVolume) {
    signal = "SELL";
  }

  if (!buySetup && !sellSetup) {
    reasons.push("Timeframe confirmation is incomplete.");

    if (!buyM5 && !sellM5) {
      reasons.push("M5 has no 3/4 directional confirmation.");
    }

    if (!buyM15 && !sellM15) {
      reasons.push("M15 has no 3/4 directional confirmation.");
    }

    if (!buyH1 && !sellH1) {
      reasons.push("H1 has fewer than 2 votes in either direction.");
    }

    if (h1BlocksBuy) reasons.push("H1 strongly opposes BUY.");
    if (h1BlocksSell) reasons.push("H1 strongly opposes SELL.");
  }

  if (buySetup && !buyStructure) {
    reasons.push("BUY blocked: no bullish M5 BOS or liquidity sweep.");
  }

  if (sellSetup && !sellStructure) {
    reasons.push("SELL blocked: no bearish M5 BOS or liquidity sweep.");
  }

  if ((buySetup || sellSetup) && !pocAvailable) {
    reasons.push(
      "Volume POC unavailable: no usable volume data. Trade blocked."
    );
  } else {
    if (buySetup && !buyVolume) {
      reasons.push("BUY blocked: price is not above POC.");
    }

    if (sellSetup && !sellVolume) {
      reasons.push("SELL blocked: price is not below POC.");
    }
  }

  if (signal === "HOLD" && reasons.length === 0) {
    reasons.push("No complete confirmed setup.");
  }

  return { signal, reasons };
}

function tradePlan(signal, m5) {
  if (!["BUY", "SELL"].includes(signal)) {
    return null;
  }

  const entry = m5.close;
  const risk = m5.atr14;

  if (!Number.isFinite(risk) || risk <= 0) {
    return null;
  }

  const distance = risk * 1.5;

  if (signal === "BUY") {
    return {
      entry,
      stopLoss: entry - distance,
      takeProfit: entry + distance * 2
    };
  }

  return {
    entry,
    stopLoss: entry + distance,
    takeProfit: entry - distance * 2
  };
}

async function main() {
  console.log("========================================");
  console.log("       FOREX SNIPER AI v3.2");
  console.log("========================================");
  console.log("Symbol: EUR/USD");
  console.log(`Time: ${new Date().toISOString()}`);
  console.log("Data source: Dukascopy downloaded candles");
  console.log("Volume profile: candle-volume POC estimate");
  console.log("Mode: PAPER ANALYSIS ONLY");
  console.log("Live orders: DISABLED");

  console.log("\nLoading M5, M15 and H1 candle files...");

  const [m5Data, m15Data, h1Data] = await Promise.all([
    loadCandles("M5"),
    loadCandles("M15"),
    loadCandles("H1")
  ]);

  const m5 = analyseTimeframe(m5Data);
  const m15 = analyseTimeframe(m15Data);
  const h1 = analyseTimeframe(h1Data);

  printTimeframe("M5 ENTRY", m5);
  printTimeframe("M15 CONFIRMATION", m15);
  printTimeframe("H1 MAIN DIRECTION", h1);

  console.log("\n========== VOLUME PROFILE CHECK ==========");
  console.log(`M5 POC:  ${price(m5.poc)}`);
  console.log(`M15 POC: ${price(m15.poc)}`);
  console.log(`H1 POC:  ${price(h1.poc)}`);

  if (Number.isFinite(m5.poc)) {
    console.log(
      m5.close > m5.poc
        ? "M5 price is ABOVE POC."
        : m5.close < m5.poc
          ? "M5 price is BELOW POC."
          : "M5 price is AT POC."
    );
  } else {
    console.log("M5 POC unavailable: volume data is missing.");
  }

  console.log("\n========== H1 CONFIRMATION RULE ==========");
  console.log("Minimum H1 confirmation: 2/4");
  console.log("Strong opposition threshold: 3/4");

  const result = evaluate(m5, m15, h1);

  console.log("\n========== MARKET CONSENSUS ==========");
  console.log(
    `Bullish votes: ${m5.bullishVotes + m15.bullishVotes + h1.bullishVotes}/12`
  );
  console.log(
    `Bearish votes: ${m5.bearishVotes + m15.bearishVotes + h1.bearishVotes}/12`
  );

  console.log("\n========== FINAL SIGNAL ==========");
  console.log(`SIGNAL: ${result.signal}`);

  const plan = tradePlan(result.signal, m5);

  if (plan) {
    console.log(`ENTRY:       ${price(plan.entry)}`);
    console.log(`STOP LOSS:   ${price(plan.stopLoss)}`);
    console.log(`TAKE PROFIT: ${price(plan.takeProfit)}`);
    console.log("RISK/REWARD: 1:2");
  } else {
    console.log("ENTRY: WAIT");
    console.log("STOP LOSS: N/A");
    console.log("TAKE PROFIT: N/A");
  }

  console.log("\n========== CONFIRMATION CHECKLIST ==========");
  console.log(`M5:  BUY ${m5.bullishVotes}/4 | SELL ${m5.bearishVotes}/4`);
  console.log(`M15: BUY ${m15.bullishVotes}/4 | SELL ${m15.bearishVotes}/4`);
  console.log(`H1:  BUY ${h1.bullishVotes}/4 | SELL ${h1.bearishVotes}/4`);

  if (result.reasons.length > 0) {
    console.log("\n========== WHY HOLD / BLOCKED ==========");

    for (const reason of result.reasons) {
      console.log(`- ${reason}`);
    }
  }

  console.log("\n========== NEWS INTELLIGENCE ==========");

  try {
    await getForexNews();
  } catch (error) {
    console.log(`News warning: ${error.message}`);
  }

  console.log("\nNews is context only; it does not create trading signals.");
  console.log("========================================");
  console.log("Analysis complete. Paper mode only.");
}

main().catch(error => {
  console.error("\nFOREX SNIPER ERROR:", error.message);
  process.exitCode = 1;
});
