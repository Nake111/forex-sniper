// Historical Polymarket BTC Up/Down token-price research. Read-only; no order execution.
import { discoverBtcUpDownMarkets, isBtcUpDownMarket } from "./polymarket-quant.js";
const CLOB = "https://clob.polymarket.com";
const FEE_BPS = Number(process.env.POLY_FEE_BPS ?? 100);
const SLIPPAGE_BPS = Number(process.env.POLY_SLIPPAGE_BPS ?? 50);
const MIN_POINTS = 12;
const get = async url => {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
};
const arr = value => Array.isArray(value) ? value : typeof value === "string" ? JSON.parse(value) : [];
function historySignal(points, index) {
  if (index < 5) return "HOLD";
  const recent = points.slice(index - 4, index + 1).map(x => x.p);
  const momentum = recent.at(-1) - recent[0];
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const prior = points.slice(Math.max(0, index - 10), index).map(x => x.p);
  const baseline = prior.reduce((a, b) => a + b, 0) / Math.max(1, prior.length);
  if (momentum > 0.04 && recent.at(-1) < 0.85 && mean > baseline) return "BUY";
  if (momentum < -0.04 && recent.at(-1) > 0.15 && mean < baseline) return "SELL";
  return "HOLD";
}
async function tokenHistory(tokenId) {
  const params = new URLSearchParams({ market: tokenId, interval: "max", fidelity: "1" });
  const data = await get(`${CLOB}/prices-history?${params}`);
  return (data.history || []).map(x => ({ t: Number(x.t), p: Number(x.p) }))
    .filter(x => Number.isFinite(x.t) && Number.isFinite(x.p) && x.p >= 0 && x.p <= 1)
    .sort((a, b) => a.t - b.t);
}
function simulate(points, outcome, marketId) {
  const trades = [];
  const cost = (FEE_BPS + SLIPPAGE_BPS) / 10000;
  for (let i = MIN_POINTS; i < points.length - 1; i++) {
    const signal = historySignal(points, i);
    if (signal !== "BUY") continue; // only buy the UP or DOWN outcome token; SELL is exit, not shorting.
    const entry = points[i].p * (1 + cost);
    if (!(entry > 0 && entry < 1)) continue;
    // Exit at the next observed sample; conservative price-only mark-to-market, not resolution PnL.
    const exit = points[i + 1].p * (1 - cost);
    const pnl = (exit - entry) / entry;
    trades.push({ marketId, outcome, entryTime: points[i].t, exitTime: points[i + 1].t, entry, exit, pnl });
    i++;
  }
  return trades;
}
async function main() {
  if (![FEE_BPS, SLIPPAGE_BPS].every(x => Number.isFinite(x) && x >= 0 && x < 5000)) throw new Error("Fee/slippage assumptions must be 0..4999 bps");
  const markets = await discoverBtcUpDownMarkets({ active: false, limit: 500 });
  const selected = markets.filter(isBtcUpDownMarket).slice(0, Number(process.env.POLY_BACKTEST_MARKETS || 30));
  const trades = [];
  let skipped = 0, fetched = 0;
  for (const market of selected) {
    const outcomes = arr(market.outcomes).map(x => String(x).toLowerCase());
    const ids = market.tokenIds;
    const upIndex = outcomes.findIndex(x => x.includes("up"));
    const downIndex = outcomes.findIndex(x => x.includes("down"));
    if (upIndex < 0 || downIndex < 0 || !ids[upIndex] || !ids[downIndex]) { skipped++; continue; }
    try {
      for (const [index, name] of [[upIndex, "UP"], [downIndex, "DOWN"]]) {
        const points = await tokenHistory(ids[index]);
        if (points.length < MIN_POINTS + 2) { skipped++; continue; }
        trades.push(...simulate(points, name, market.id));
        fetched++;
      }
    } catch (error) {
      skipped++;
      console.error(`Skipped market ${market.id}: ${error.message}`);
    }
  }
  const wins = trades.filter(t => t.pnl > 0).length;
  const net = trades.reduce((sum, t) => sum + t.pnl, 0);
  const avg = trades.length ? net / trades.length : 0;
  console.log("\nPOLYMARKET BTC UP/DOWN HISTORICAL PRICE RESEARCH");
  console.log(`Markets discovered: ${markets.length}; tokens with usable history: ${fetched}; skipped items: ${skipped}`);
  console.log(`Trades: ${trades.length}; wins: ${wins}; win rate: ${trades.length ? (wins / trades.length * 100).toFixed(2) : "N/A"}%`);
  console.log(`Sum of per-trade returns (not compounded): ${(net * 100).toFixed(3)}%; average: ${(avg * 100).toFixed(4)}%`);
  console.log(`Assumed fee: ${FEE_BPS} bps; slippage: ${SLIPPAGE_BPS} bps per side`);
  console.log("Limitations: CLOB history is sampled token prices, not historical order books/fills; this first-pass test marks the next sample and does not use resolved outcome PnL. Not a profitability claim.");
}
main().catch(error => { console.error("Polymarket backtest failed:", error); process.exitCode = 1; });
