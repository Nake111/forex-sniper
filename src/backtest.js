
import { readFile } from "node:fs/promises";
import { analyseTimeframe } from "./market.js";
import { tradePlan } from "./trade-plan.js";

// Round-trip trading cost in basis points.
// 10 bps = 0.10% of entry price. Adjust for your broker/exchange.
const MARKET = (process.env.MARKET ?? "BTCUSD").toUpperCase();
if (!["BTCUSD", "EURUSD"].includes(MARKET)) {
  throw new Error("MARKET must be BTCUSD or EURUSD");
}
const DATA_PREFIX = MARKET.toLowerCase();
const COST_BPS = Number(process.env.BACKTEST_COST_BPS ?? (MARKET === "EURUSD" ? 0.5 : 10));

const WINDOW = 120;
const MIN_HISTORY = 60;

function getTime(c) {
  const raw = c.timestamp ?? c.time ?? c.date;
  let t = typeof raw === "number" ? raw : Date.parse(raw);
  if (!Number.isFinite(t)) return NaN;
  return t < 1e12 ? t * 1000 : t;
}

function normalize(data, name) {
  const candles = data.map(c => ({
    time: getTime(c),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume ?? 0)
  })).filter(c =>
    Number.isFinite(c.time) &&
    [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
    c.high >= c.low
  ).sort((a, b) => a.time - b.time);

  if (candles.length < MIN_HISTORY + 2) {
    throw new Error(`${name}: insufficient valid candles`);
  }

  return candles;
}

async function load(path, name) {
  return normalize(
    JSON.parse(await readFile(path, "utf8")),
    name
  );
}

function latestClosed(candles, interval, closeTime, previous) {
  let index = previous;

  while (
    index + 1 < candles.length &&
    candles[index + 1].time + interval <= closeTime
  ) {
    index++;
  }

  return index;
}

function evaluateSignal({ M5: m5, M15: m15, H1: h1 }) {
  const s = m5.structure ?? {};

  const bullishStructure =
    s.bos === "BULLISH" ||
    s.sweep === "BULLISH" ||
    (s.sweepConfirmed && s.liquiditySweep === "BULLISH");

  const bearishStructure =
    s.bos === "BEARISH" ||
    s.sweep === "BEARISH" ||
    (s.sweepConfirmed && s.liquiditySweep === "BEARISH");

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

function confirmation(signal, h1) {
  if (signal === "HOLD") return { status: "NO TRADE" };

  const s = h1.squeeze;

  if (!s || !Number.isFinite(s.momentum)) {
    return { status: "WAIT" };
  }

  if (s.state !== "SQUEEZE_RELEASED") {
    return { status: "WAIT" };
  }

  if (signal === "BUY" && !s.direction?.startsWith("BULLISH")) {
    return { status: "WAIT" };
  }

  if (signal === "SELL" && !s.direction?.startsWith("BEARISH")) {
    return { status: "WAIT" };
  }

  return { status: "H1 ALIGNED" };
}

function analyse(candles, index) {
  const start = Math.max(0, index - WINDOW + 1);
  const window = candles.slice(start, index + 1);

  if (window.length < MIN_HISTORY) return null;

  return analyseTimeframe(window);
}

function resolveExit(side, candle, sl, tp) {
  const stopHit = side === "BUY"
    ? candle.low <= sl
    : candle.high >= sl;

  const targetHit = side === "BUY"
    ? candle.high >= tp
    : candle.low <= tp;

  // Conservative assumption: stop wins if both levels are touched.
  if (stopHit) {
    const gap = side === "BUY"
      ? candle.open < sl
      : candle.open > sl;

    return {
      outcome: "LOSS",
      price: gap ? candle.open : sl
    };
  }

  if (targetHit) {
    return { outcome: "WIN", price: tp };
  }

  return null;
}

function maxDrawdown(trades) {
  let equity = 0;
  let peak = 0;
  let maximum = 0;

  for (const trade of trades) {
    equity += trade.netR;
    peak = Math.max(peak, equity);
    maximum = Math.max(maximum, peak - equity);
  }

  return maximum;
}

async function main() {
  if (!Number.isFinite(COST_BPS) || COST_BPS < 0) {
    throw new Error("Invalid BACKTEST_COST_BPS");
  }

  const [m5, m15, h1] = await Promise.all([
    load(`data/${DATA_PREFIX}-m5.json`, "M5"),
    load(`data/${DATA_PREFIX}-m15.json`, "M15"),
    load(`data/${DATA_PREFIX}-h1.json`, "H1")
  ]);

  const trades = [];

  let m15Index = -1;
  let h1Index = -1;
  let cachedM15 = null;
  let cachedH1 = null;
  let previousM15 = -1;
  let previousH1 = -1;
  let signalsChecked = 0;
  let openAtEnd = 0;

  let i = MIN_HISTORY - 1;

  while (i < m5.length - 1) {
    const closeTime = m5[i].time + 5 * 60 * 1000;

    m15Index = latestClosed(
      m15, 15 * 60 * 1000, closeTime, m15Index
    );

    h1Index = latestClosed(
      h1, 60 * 60 * 1000, closeTime, h1Index
    );

    if (
      m15Index >= MIN_HISTORY - 1 &&
      m15Index !== previousM15
    ) {
      cachedM15 = analyse(m15, m15Index);
      previousM15 = m15Index;
    }

    if (
      h1Index >= MIN_HISTORY - 1 &&
      h1Index !== previousH1
    ) {
      cachedH1 = analyse(h1, h1Index);
      previousH1 = h1Index;
    }

    const currentM5 = analyse(m5, i);

    if (!currentM5 || !cachedM15 || !cachedH1) {
      i++;
      continue;
    }

    const results = {
      M5: currentM5,
      M15: cachedM15,
      H1: cachedH1
    };

    const signal = evaluateSignal(results);
    const confirm = confirmation(signal, cachedH1);
    const plan = tradePlan(signal, currentM5, confirm);

    signalsChecked++;

    if (!plan) {
      i++;
      continue;
    }

    // Signal is known at this candle close.
    // Entry is the next M5 candle open.
    const entryIndex = i + 1;
    const entry = m5[entryIndex].open;

    const risk = currentM5.atr14 * 1.5;
    const reward = currentM5.atr14 * 3;

    if (
      !Number.isFinite(entry) ||
      !Number.isFinite(risk) ||
      risk <= 0
    ) {
      i++;
      continue;
    }

    const sl = signal === "BUY"
      ? entry - risk
      : entry + risk;

    const tp = signal === "BUY"
      ? entry + reward
      : entry - reward;

    let exit = null;
    let exitIndex = entryIndex;

    for (let j = entryIndex; j < m5.length; j++) {
      exit = resolveExit(signal, m5[j], sl, tp);

      if (exit) {
        exitIndex = j;
        break;
      }
    }

    if (!exit) {
      openAtEnd++;
      break;
    }

    const grossMove = signal === "BUY"
      ? exit.price - entry
      : entry - exit.price;

    // Convert round-trip basis-point cost into instrument price units.
    const costInPrice = entry * COST_BPS / 10000;

    const netMove = grossMove - costInPrice;
    const netR = netMove / risk;
    const netPercent = (netMove / entry) * 100;

    trades.push({
      side: signal,
      outcome: exit.outcome,
      entryTime: new Date(m5[entryIndex].time).toISOString(),
      exitTime: new Date(m5[exitIndex].time).toISOString(),
      netMove,
      netPercent,
      netR
    });

    i = exitIndex + 1;
  }

  const profitable = trades.filter(t => t.netR > 0);
  const unprofitable = trades.filter(t => t.netR <= 0);

  const totalNetMove = trades.reduce(
    (sum, t) => sum + t.netMove,
    0
  );

  const totalNetR = trades.reduce(
    (sum, t) => sum + t.netR,
    0
  );

  const profit = profitable.reduce(
    (sum, t) => sum + t.netR,
    0
  );

  const loss = Math.abs(unprofitable.reduce(
    (sum, t) => sum + t.netR,
    0
  ));

  const factor = loss > 0 ? profit / loss : null;

  const winRate = trades.length
    ? profitable.length / trades.length * 100
    : 0;

  console.log("\n========== " + MARKET + " HISTORICAL BACKTEST ==========");
  console.log("PAIR:", MARKET === "EURUSD" ? "EUR/USD" : "BTC/USD");
  console.log("SIGNAL: M5 + M15 + H1");

  console.log(
    `Period: ${new Date(m5[0].time).toISOString()} to ` +
    `${new Date(m5.at(-1).time).toISOString()}`
  );

  console.log(
    `Candles: M5 ${m5.length} | M15 ${m15.length} | H1 ${h1.length}`
  );

  console.log(`Signals evaluated: ${signalsChecked}`);
  console.log(`Closed trades: ${trades.length}`);
  console.log(`Open at end, excluded: ${openAtEnd}`);

  console.log(
    `BUY: ${trades.filter(t => t.side === "BUY").length}`
  );

  console.log(
    `SELL: ${trades.filter(t => t.side === "SELL").length}`
  );

  console.log(`Net profitable trades: ${profitable.length}`);
  console.log(`Net unprofitable trades: ${unprofitable.length}`);
  console.log(`Win rate: ${winRate.toFixed(2)}%`);
  console.log(`Net price movement: ${totalNetMove.toFixed(MARKET === "EURUSD" ? 5 : 2)} per unit`);
  console.log(`Net result: ${totalNetR.toFixed(2)} R`);

  console.log(
    `Profit factor: ${factor === null ? "N/A" : factor.toFixed(2)}`
  );

  console.log(
    `Maximum drawdown: ${maxDrawdown(trades).toFixed(2)} R`
  );

  console.log(`Round-trip cost assumption: ${COST_BPS} bps`);
  console.log(`Equivalent percentage cost: ${(COST_BPS / 100).toFixed(3)}%`);

  console.log("Entry: next M5 candle open.");
  console.log("If SL and TP hit in one candle, SL is counted first.");
  console.log("Unclosed trades are excluded.");
  console.log("This is a historical simulation, not a live performance claim.");
  console.log("=================================================");

  if (!trades.length) {
    console.log("No completed trades. No performance conclusion can be drawn.");
  }
}

main().catch(error => {
  console.error(`${MARKET} BACKTEST ERROR:`, error);
  process.exitCode = 1;
});
