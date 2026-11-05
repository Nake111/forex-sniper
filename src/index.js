
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
  const raw = await readFile(DATA_FILES[timeframe], "utf8");
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
    throw new Error(`${timeframe}: insufficient valid candles.`);
  }

  const volumeCandles = candles.filter(c => c.volume > 0).length;

  console.log(
    `${timeframe}: ${candles.length} candles loaded; ` +
    `${volumeCandles} contain volume.`
  );

  return candles;
}

function printSmartMoney(name, smc) {
  console.log(`\n========== ${name} SMART MONEY CONCEPTS ==========`);

  console.log("\n--- SWING STRUCTURE ---");
  console.log(`Direction: ${smc.swing.direction}`);
  console.log(`Event:     ${smc.swing.type}`);
  console.log(`Level:     ${price(smc.swing.level)}`);
  console.log(`Bars ago:  ${smc.swing.barsAgo ?? "N/A"}`);

  console.log("\n--- INTERNAL STRUCTURE ---");
  console.log(`Direction: ${smc.internal.direction}`);
  console.log(`Event:     ${smc.internal.type}`);
  console.log(`Level:     ${price(smc.internal.level)}`);
  console.log(`Bars ago:  ${smc.internal.barsAgo ?? "N/A"}`);

  console.log("\n--- SWING LEVELS ---");
  console.log(`Swing High: ${price(smc.swingHigh)}`);
  console.log(`Swing Low:  ${price(smc.swingLow)}`);

  console.log("\n--- ORDER BLOCKS ---");

  if (!smc.orderBlocks.length) {
    console.log("No order blocks detected.");
  } else {
    for (const ob of smc.orderBlocks) {
      console.log(
        `${ob.direction} OB | High: ${price(ob.high)} | ` +
        `Low: ${price(ob.low)} | Midpoint: ${price(ob.midpoint)} | ` +
        `Bars ago: ${ob.barsAgo} | Status: ${ob.status} | ` +
        `Touched: ${ob.touched ? "YES" : "NO"} | ` +
        `Mitigated: ${ob.mitigated ? "YES" : "NO"} | ` +
        `Invalidated: ${ob.invalidated ? "YES" : "NO"}`
      );
    }
  }

  console.log("\n--- FAIR VALUE GAPS ---");

  if (!smc.fairValueGaps.length) {
    console.log("No unfilled FVG detected.");
  } else {
    for (const fvg of smc.fairValueGaps) {
      console.log(
        `${fvg.direction} FVG | Top: ${price(fvg.top)} | ` +
        `Bottom: ${price(fvg.bottom)} | Bars ago: ${fvg.barsAgo}`
      );
    }
  }

  console.log("\n--- LIQUIDITY LEVELS ---");
  console.log(`Equal High: ${price(smc.equalHigh)}`);
  console.log(`Equal Low:  ${price(smc.equalLow)}`);

  console.log("\n--- PREMIUM / DISCOUNT ---");
  console.log(`Range High:  ${price(smc.rangeHigh)}`);
  console.log(`Range Low:   ${price(smc.rangeLow)}`);
  console.log(`Equilibrium: ${price(smc.equilibrium)}`);
  console.log(`Current Zone: ${smc.zone}`);
}

function printTimeframe(name, result) {
  const s = result.structure;

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

  console.log("\n--- MARKET STRUCTURE ---");
  console.log(`Swing High: ${price(s.swingHigh)}`);
  console.log(`Swing Low:  ${price(s.swingLow)}`);
  console.log(`BOS:        ${s.bos}`);
  console.log(`BOS Level:  ${price(s.bosLevel)}`);

  console.log("\n--- LIQUIDITY SWEEP ---");
  console.log(`Sweep:      ${s.liquiditySweep}`);
  console.log(`Sweep Level: ${price(s.liquiditySweepLevel)}`);
  console.log(`Confirmed:  ${s.sweepConfirmed ? "YES" : "NO"}`);

  console.log("\n--- DAILY LEVELS ---");
  console.log(`Previous Day High: ${price(s.previousDayHigh)}`);
  console.log(`Previous Day Low:  ${price(s.previousDayLow)}`);

  printSmartMoney(name, result.smartMoney);
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
  }

  if (buySetup && !buyStructure) {
    reasons.push("BUY blocked: no bullish M5 BOS or liquidity sweep.");
  }

  if (sellSetup && !sellStructure) {
    reasons.push("SELL blocked: no bearish M5 BOS or liquidity sweep.");
  }

  if ((buySetup || sellSetup) && !pocAvailable) {
    reasons.push("Volume POC unavailable. Trade blocked.");
  } else {
    if (buySetup && !buyVolume) {
      reasons.push("BUY blocked: price is not above POC.");
    }

    if (sellSetup && !sellVolume) {
      reasons.push("SELL blocked: price is not below POC.");
    }
  }

  if (h1BlocksBuy) reasons.push("H1 strongly opposes BUY.");
  if (h1BlocksSell) reasons.push("H1 strongly opposes SELL.");

  if (signal === "HOLD" && reasons.length === 0) {
    reasons.push("No complete confirmed setup.");
  }

  return { signal, reasons };
}

function tradePlan(signal, m5) {
  if (!["BUY", "SELL"].includes(signal)) return null;

  const entry = m5.close;
  const risk = m5.atr14;

  if (!Number.isFinite(risk) || risk <= 0) return null;

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
  console.log("       FOREX SNIPER AI v3.4");
  console.log("========================================");
  console.log("Symbol: EUR/USD");
  console.log(`Time: ${new Date().toISOString()}`);
  console.log("Data: Dukascopy");
  console.log("Indicators: EMA / RSI / MACD / ATR");
  console.log("Smart Money: BOS / CHoCH / OB / FVG / Liquidity");
  console.log("Order Block Status: FRESH / TOUCHED / MITIGATED / INVALIDATED");
  console.log("Volume Profile: Candle-volume POC estimate");
  console.log("Mode: PAPER ANALYSIS ONLY");
  console.log("Live orders: DISABLED");

  console.log("\nLoading M5, M15 and H1...");

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

  console.log("\n========== VOLUME PROFILE ==========");
  console.log(`M5 POC:  ${price(m5.poc)}`);
  console.log(`M15 POC: ${price(m15.poc)}`);
  console.log(`H1 POC:  ${price(h1.poc)}`);

  console.log("\n========== MARKET CONSENSUS ==========");
  console.log(
    `Bullish votes: ${
      m5.bullishVotes + m15.bullishVotes + h1.bullishVotes
    }/12`
  );
  console.log(
    `Bearish votes: ${
      m5.bearishVotes + m15.bearishVotes + h1.bearishVotes
    }/12`
  );

  const result = evaluate(m5, m15, h1);

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

  console.log("\n========== WHY HOLD / BLOCKED ==========");

  for (const reason of result.reasons) {
    console.log(`- ${reason}`);
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
