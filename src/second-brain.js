import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";

const LIMIT = 3000;
const finite = Number.isFinite;

async function readJournal(path) {
  try {
    const raw = await readFile(path, "utf8");
    return raw.split("\n").filter(Boolean).map(line => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeJournal(path, records) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + ".tmp";
  await writeFile(temporary, records.slice(-LIMIT).map(record => JSON.stringify(record)).join("\n") + "\n");
  await rename(temporary, path);
}

function candleTime(candle) {
  const raw = candle.timestamp ?? candle.time ?? candle.date;
  const value = typeof raw === "number" ? raw : Date.parse(raw);
  return finite(value) ? (value < 1e12 ? value * 1000 : value) : NaN;
}

/**
 * Persistent, append-only research memory for the Forex Sniper.
 * It stores the evidence behind each decision and resolves paper setups only
 * when later closed candles touch a stored stop or target. It never places orders.
 */
export async function updateSecondBrain({
  market, candles = [], signal = "HOLD", plan = null, vwap = {},
  agents = {}, llm = {}, macro = {}, frames = {}, path = "data/second-brain.jsonl",
  now = Date.now()
}) {
  const records = await readJournal(path);
  const validCandles = candles.filter(c => [c.open, c.high, c.low, c.close].every(v => finite(Number(v))) &&
    finite(candleTime(c))).sort((a, b) => candleTime(a) - candleTime(b));

  // Resolve previously recorded paper setups with candles strictly after entry.
  for (const record of records) {
    if (record.market !== market || record.kind !== "SIGNAL" || record.outcome !== "PENDING") continue;
    for (const candle of validCandles) {
      if (candleTime(candle) <= record.createdAt) continue;
      const high = Number(candle.high), low = Number(candle.low);
      const stopHit = record.side === "BUY" ? low <= record.stopLoss : high >= record.stopLoss;
      const targetHit = record.side === "BUY" ? high >= record.takeProfit : low <= record.takeProfit;
      if (stopHit && targetHit) {
        record.outcome = "AMBIGUOUS";
        record.resolvedAt = candleTime(candle);
        record.resolutionNote = "Stop and target both touched in the same candle; sequence unknown";
        break;
      } else if (stopHit || targetHit) {
        record.outcome = targetHit ? "WIN" : "LOSS";
        record.resolvedAt = candleTime(candle);
        record.resolutionPrice = targetHit ? record.takeProfit : record.stopLoss;
        break;
      }
    }
  }

  const timeframeSummary = Object.fromEntries(["M5", "M15", "H1", "H4"].map(key => {
    const frame = frames[key] ?? {};
    return [key, {
      close: finite(frame.close) ? frame.close : null,
      regime: frame.regime ?? "UNKNOWN",
      rsi14: finite(frame.rsi14) ? frame.rsi14 : null,
      adx14: finite(frame.adx14) ? frame.adx14 : null,
      vwap: finite(frame.vwap) ? frame.vwap : null,
      poc: finite(frame.poc) ? frame.poc : null,
      bos: frame.structure?.bos ?? "NONE",
      sweep: frame.structure?.sweep ?? "NONE"
    }];
  }));
  const side = ["BUY", "SELL"].includes(signal) && plan ? signal : null;
  const latest = validCandles.at(-1);
  const key = market + ":" + now;
  if (!records.some(record => record.key === key)) {
    records.push({
      key, kind: side ? "SIGNAL" : "OBSERVATION", market, createdAt: now,
      side: side ?? "NO_TRADE",
      entry: side ? plan.entry : null,
      stopLoss: side ? plan.stopLoss : null,
      takeProfit: side ? plan.takeProfit : null,
      riskReward: side ? plan.riskReward : null,
      outcome: side ? "PENDING" : null,
      close: latest ? Number(latest.close) : null,
      candleAt: latest ? candleTime(latest) : null,
      vwap: {
        consensus: vwap.signal ?? "HOLD", buys: vwap.buys ?? 0, sells: vwap.sells ?? 0,
        strategies: (vwap.strategies ?? []).map(item => ({ name: item.name, signal: item.signal }))
      },
      agents: {
        decision: agents.portfolioManager?.decision ?? "UNKNOWN",
        votes: (agents.agents ?? []).map(agent => ({
          name: agent.name, direction: agent.direction, weight: agent.weight
        }))
      },
      llm: { status: llm.status ?? "NOT_CONFIGURED", decision: llm.decision ?? "UNKNOWN" },
      macro: { eventRisk: macro.eventRisk ?? "UNKNOWN", dataStale: macro.dataStale === true },
      timeframes: timeframeSummary
    });
  }

  await writeJournal(path, records);
  const outcomes = records.filter(record => record.market === market && record.kind === "SIGNAL" &&
    ["WIN", "LOSS", "AMBIGUOUS", "PENDING"].includes(record.outcome));
  const wins = outcomes.filter(record => record.outcome === "WIN").length;
  const losses = outcomes.filter(record => record.outcome === "LOSS").length;
  return {
    stored: true, records: records.length, marketSignals: outcomes.length,
    resolved: wins + losses, wins, losses,
    winRatePct: wins + losses ? Number((wins / (wins + losses) * 100).toFixed(1)) : null,
    pending: outcomes.filter(record => record.outcome === "PENDING").length,
    ambiguous: outcomes.filter(record => record.outcome === "AMBIGUOUS").length
  };
}
