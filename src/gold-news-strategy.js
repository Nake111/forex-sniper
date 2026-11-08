const MINUTE = 60_000;
const FIVE_MINUTES = 5 * MINUTE;
const PRE_RELEASE_LOCK = 30 * MINUTE;
const RELEASE_LOCK = 5 * MINUTE;
const POST_RELEASE_WINDOW = 30 * MINUTE;
const RELEVANT_EVENT = /(cpi|consumer price|inflation|employment situation|nonfarm|payroll|fomc|rate decision|producer price|pce|personal consumption|retail sales|gross domestic product|gdp)/i;

function toTimestamp(raw) {
  const value = typeof raw === "number" ? raw : Date.parse(raw ?? "");
  if (!Number.isFinite(value)) return NaN;
  return value < 1e12 ? value * 1000 : value;
}
function candleTime(candle) {
  return toTimestamp(candle.timestamp ?? candle.time ?? candle.date);
}
function eventTime(event) {
  return toTimestamp(event.timestamp ?? event.scheduledAt ?? event.date);
}
export function getGoldNewsWindow(events = [], now = Date.now()) {
  const candidates = events
    .filter(event => RELEVANT_EVENT.test(String(event.name ?? event.title ?? "")))
    .map(event => ({ ...event, timestamp: eventTime(event) }))
    .filter(event => Number.isFinite(event.timestamp) &&
      now - event.timestamp <= POST_RELEASE_WINDOW &&
      event.timestamp - now <= PRE_RELEASE_LOCK)
    .sort((a, b) => Math.abs(now - a.timestamp) - Math.abs(now - b.timestamp));
  const event = candidates[0] ?? null;
  if (!event) return { phase: "NORMAL", blockNewEntries: false, event: null, reason: "No scheduled high-impact US release in the configured window." };
  const age = now - event.timestamp;
  if (age < 0) return { phase: "PRE_RELEASE_LOCK", blockNewEntries: true, event, minutesToRelease: Math.ceil(-age / MINUTE), reason: "Avoid opening new Gold positions before the scheduled release." };
  if (age < RELEASE_LOCK) return { phase: "RELEASE_LOCK", blockNewEntries: true, event, minutesSinceRelease: Math.floor(age / MINUTE), reason: "The initial release candle is not a reliable entry signal." };
  return { phase: "POST_RELEASE_CONFIRMATION", blockNewEntries: true, event, minutesSinceRelease: Math.floor(age / MINUTE), reason: "Evaluate a closed-candle breakout and retest; execution remains blocked pending broker spread verification." };
}
function median(values) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
export function evaluateGoldNewsCandle(candles, event, now = Date.now()) {
  const release = eventTime(event ?? {});
  if (!Number.isFinite(release) || !Array.isArray(candles)) return { signal: "HOLD", reason: "Missing event time or M5 candle history." };
  const bars = candles.map(candle => ({
    ...candle, timestamp: candleTime(candle),
    open: Number(candle.open), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close)
  })).filter(c => Number.isFinite(c.timestamp) &&
    [c.open,c.high,c.low,c.close].every(Number.isFinite) &&
    c.high >= Math.max(c.open,c.close,c.low) && c.low <= Math.min(c.open,c.close,c.high) &&
    c.timestamp + FIVE_MINUTES <= now).sort((a,b) => a.timestamp-b.timestamp);
  const pre = bars.filter(c => c.timestamp >= release-PRE_RELEASE_LOCK && c.timestamp+FIVE_MINUTES <= release);
  const post = bars.filter(c => c.timestamp >= release && c.timestamp < release+POST_RELEASE_WINDOW);
  if (now-release < RELEASE_LOCK || now-release > POST_RELEASE_WINDOW) return { signal:"HOLD",reason:"Outside the post-release confirmation window." };
  if (pre.length < 3 || post.length < 2) return { signal:"HOLD",reason:"Not enough fully closed pre-release and post-release M5 candles." };
  const impulse=post.at(-2), retest=post.at(-1);
  const preHigh=Math.max(...pre.map(c=>c.high)), preLow=Math.min(...pre.map(c=>c.low));
  const typicalRange=median(pre.slice(-12).map(c=>c.high-c.low).filter(v=>v>0));
  if(!Number.isFinite(typicalRange)||typicalRange<=0) return {signal:"HOLD",reason:"Unable to estimate normal pre-release candle range."};
  if(impulse.high-impulse.low>typicalRange*4) return {signal:"HOLD",reason:"Initial news impulse is unusually extended; avoid chasing the spike."};
  const buffer=typicalRange*0.15;
  const bullish=impulse.close>preHigh && retest.low<=preHigh+buffer && retest.close>preHigh && retest.close>retest.open;
  const bearish=impulse.close<preLow && retest.high>=preLow-buffer && retest.close<preLow && retest.close<retest.open;
  if(!bullish&&!bearish) return {signal:"HOLD",reason:"No confirmed breakout-and-retest of the 30-minute pre-news range.",preNewsHigh:preHigh,preNewsLow:preLow,typicalM5Range:typicalRange};
  const signal=bullish?"BUY":"SELL", entry=retest.close;
  const stopLoss=bullish?Math.min(retest.low,preHigh)-buffer:Math.max(retest.high,preLow)+buffer;
  const risk=Math.abs(entry-stopLoss);
  if(!Number.isFinite(risk)||risk<=0||risk>typicalRange*3) return {signal:"HOLD",reason:"Retest stop distance is too wide for the recent pre-news range."};
  return {
    signal,entry,stopLoss,
    takeProfit1:bullish?entry+risk:entry-risk,
    takeProfit2:bullish?entry+risk*1.5:entry-risk*1.5,
    takeProfit3:bullish?entry+risk*2:entry-risk*2,
    riskReward:"1:1 / 1:1.5 / 1:2",
    preNewsHigh:preHigh,preNewsLow:preLow,typicalM5Range:typicalRange,
    confirmation:"First post-release M5 close breaks the pre-news range; second closed M5 candle retests and holds the breakout level.",
    executionStatus:"CANDIDATE_ONLY",
    executionBlock:"Vantage bid/ask spread and slippage are not connected or verified."
  };
}