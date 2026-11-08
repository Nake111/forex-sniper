import { readFile } from "node:fs/promises";
import { analyseDonchian, evaluateDonchianSignal } from "./donchian-strategy.js";

const COST_BPS = Number(process.env.BACKTEST_COST_BPS ?? 10);
const LOOKBACK = 300;
const MIN_HISTORY = 220;

function timestamp(c) {
  const raw = c.timestamp ?? c.time ?? c.date;
  const value = typeof raw === "number" ? raw : Date.parse(raw);
  return value < 1e12 ? value * 1000 : value;
}
async function load(path) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  return raw.map(c => ({ time: timestamp(c), open:+c.open, high:+c.high, low:+c.low, close:+c.close, volume:+(c.volume ?? 0) }))
    .filter(c => Number.isFinite(c.time) && [c.open,c.high,c.low,c.close].every(Number.isFinite))
    .sort((a,b)=>a.time-b.time);
}
function latestClosed(candles, interval, closeTime, previous) {
  let i = previous;
  while (i + 1 < candles.length && candles[i + 1].time + interval <= closeTime) i++;
  return i;
}
function exitTrade(side, candle, sl, tp) {
  const stop = side === "BUY" ? candle.low <= sl : candle.high >= sl;
  const target = side === "BUY" ? candle.high >= tp : candle.low <= tp;
  if (stop) return { price: side === "BUY" && candle.open < sl ? candle.open : side === "SELL" && candle.open > sl ? candle.open : sl, result: "LOSS" };
  if (target) return { price: tp, result: "WIN" };
  return null;
}
async function main() {
  const [m5,m15,h1] = await Promise.all([
    load("data/btcusd-m5.json"), load("data/btcusd-m15.json"), load("data/btcusd-h1.json")
  ]);
  const trades = [];
  let i15 = -1, i1 = -1, a15 = null, a1 = null, last15 = -1, last1 = -1, lastEvaluated15 = -1;
  let checked = 0, openAtEnd = 0;
  for (let i = MIN_HISTORY - 1; i < m5.length - 1; i++) {
    const closeTime = m5[i].time + 5 * 60_000;
    i15 = latestClosed(m15, 15 * 60_000, closeTime, i15);
    i1 = latestClosed(h1, 60 * 60_000, closeTime, i1);
    if (i15 >= MIN_HISTORY - 1 && i15 !== last15) {
      a15 = analyseDonchian(m15.slice(Math.max(0,i15-LOOKBACK+1),i15+1));
      last15 = i15;
    }
    if (i1 >= MIN_HISTORY - 1 && i1 !== last1) {
      a1 = analyseDonchian(h1.slice(Math.max(0,i1-LOOKBACK+1),i1+1));
      last1 = i1;
    }
    if (!a15 || !a1) continue;
    const a5 = analyseDonchian(m5.slice(Math.max(0,i-LOOKBACK+1),i+1));
    const signal = evaluateDonchianSignal({ M5:a5, M15:a15, H1:a1 });
    checked++;
    if (signal === "HOLD") continue;
    const entryIndex = i + 1, entry = m5[entryIndex].open;
    const risk = 2 * a5.atr14, reward = 3 * a5.atr14;
    if (!(entry > 0 && risk > 0)) continue;
    const sl = signal === "BUY" ? entry-risk : entry+risk;
    const tp = signal === "BUY" ? entry+reward : entry-reward;
    let exit = null, exitIndex = entryIndex;
    for (let j=entryIndex;j<m5.length;j++) {
      exit = exitTrade(signal,m5[j],sl,tp);
      if (exit) { exitIndex=j; break; }
    }
    if (!exit) { openAtEnd++; break; }
    const gross = signal === "BUY" ? exit.price-entry : entry-exit.price;
    const cost = entry * COST_BPS / 10000;
    const netR = (gross-cost)/risk;
    trades.push({ side:signal, netR, result:netR>0?"WIN":"LOSS", entryTime:new Date(m5[entryIndex].time).toISOString(), exitTime:new Date(m5[exitIndex].time).toISOString() });
    i = exitIndex;
  }
  const wins=trades.filter(t=>t.netR>0), losses=trades.filter(t=>t.netR<=0);
  const grossWin=wins.reduce((s,t)=>s+t.netR,0), grossLoss=Math.abs(losses.reduce((s,t)=>s+t.netR,0));
  const pf=grossLoss?grossWin/grossLoss:null;
  let equity=0,peak=0,dd=0;
  for(const t of trades){ equity+=t.netR; peak=Math.max(peak,equity); dd=Math.max(dd,peak-equity); }
  console.log("\n========== BTCUSD DONCHIAN BREAKOUT BACKTEST ==========");
  console.log("Strategy: M15 20-bar Donchian breakout; H1 EMA50/200 trend; M15 ADX14 + relative volume; M5 EMA20 + RSI14 confirmation");
  console.log(`Data: M5 ${m5.length} | M15 ${m15.length} | H1 ${h1.length}`);
  console.log(`Period: ${new Date(m5[0].time).toISOString()} to ${new Date(m5.at(-1).time).toISOString()}`);
  console.log(`Signals checked: ${checked} | Closed trades: ${trades.length} | Open at end: ${openAtEnd}`);
  console.log(`BUY: ${trades.filter(t=>t.side==="BUY").length} | SELL: ${trades.filter(t=>t.side==="SELL").length}`);
  console.log(`Win rate: ${trades.length?(wins.length/trades.length*100).toFixed(2):"0.00"}%`);
  console.log(`Profit factor: ${pf===null?"N/A":pf.toFixed(2)} | Net R: ${trades.reduce((s,t)=>s+t.netR,0).toFixed(2)} | Max DD: ${dd.toFixed(2)} R`);
  console.log(`Stops: 2 ATR | Target: 3 ATR (1:1.5) | Round-trip costs: ${COST_BPS} bps`);
  console.log("Conservative same-candle rule: stop is assumed hit before target.");
  console.log("This is a historical simulation, not a live performance claim.");
}
main().catch(e=>{ console.error("DONCHIAN BACKTEST ERROR:",e); process.exitCode=1; });
