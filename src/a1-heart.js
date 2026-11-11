// A1 HEART: multi-session opening-range breakout, volume confirmation,
// volume-profile pullback and candle-based absorption proxy.
// Session clocks use IANA time zones so daylight-saving transitions are automatic.
// Volume is venue-specific tick/contract volume, not consolidated FX volume.
const SESSIONS = Object.freeze([
  { id: "sydney", name: "Sydney", timeZone: "Australia/Sydney", open: 9 * 60, rangeMinutes: 30 },
  { id: "tokyo", name: "Tokyo", timeZone: "Asia/Tokyo", open: 9 * 60, rangeMinutes: 30 },
  { id: "london", name: "London", timeZone: "Europe/London", open: 8 * 60, rangeMinutes: 30 },
  { id: "newYork", name: "New York", timeZone: "America/New_York", open: 9 * 60 + 30, rangeMinutes: 30 }
]);
const formatters = new Map(SESSIONS.map(s => [s.id, new Intl.DateTimeFormat("en-GB", {
  timeZone: s.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23"
})]));
function zonedParts(timestamp, session) {
  const p = Object.fromEntries(formatters.get(session.id).formatToParts(new Date(timestamp))
    .filter(x => x.type !== "literal").map(x => [x.type, x.value]));
  return { day: p.year + "-" + p.month + "-" + p.day,
    minute: Number(p.hour) * 60 + Number(p.minute) };
}
function offsetAt(timestamp, session) {
  const p = zonedParts(timestamp, session);
  const [year, month, day] = p.day.split("-").map(Number);
  return Date.UTC(year, month - 1, day, Math.floor(p.minute / 60), p.minute % 60) - timestamp;
}
function localToUtc(day, minute, session) {
  const [year, month, date] = day.split("-").map(Number);
  const localAsUtc = Date.UTC(year, month - 1, date, Math.floor(minute / 60), minute % 60);
  let guess = localAsUtc;
  for (let i = 0; i < 3; i++) guess = localAsUtc - offsetAt(guess, session);
  return guess;
}
function avg(values) { return values.length ? values.reduce((a,b)=>a+b,0)/values.length : null; }
function profile(candles, bins = 24) {
  const valid = candles.filter(c => c.volume > 0 && Number.isFinite(c.high) &&
    Number.isFinite(c.low) && c.high >= c.low);
  if (valid.length < 6) return null;
  const lo = Math.min(...valid.map(c=>c.low)), hi = Math.max(...valid.map(c=>c.high));
  if (!(hi > lo)) return null;
  const step = (hi-lo)/bins, weights = Array(bins).fill(0);
  for (const c of valid) {
    const typical = (c.high+c.low+c.close)/3;
    const i = Math.max(0,Math.min(bins-1,Math.floor((typical-lo)/step)));
    weights[i] += c.volume;
  }
  const total = weights.reduce((a,b)=>a+b,0), pocIndex = weights.indexOf(Math.max(...weights));
  const target = total*0.70; let accumulated=weights[pocIndex], left=pocIndex, right=pocIndex;
  while (accumulated < target && (left>0 || right<bins-1)) {
    const l=left>0?weights[left-1]:-1, r=right<bins-1?weights[right+1]:-1;
    if (r>l) { right++; accumulated+=weights[right]; }
    else { left--; accumulated+=weights[left]; }
  }
  return { poc:lo+(pocIndex+0.5)*step, val:lo+left*step, vah:lo+(right+1)*step, totalVolume:total };
}
function evaluateSession(valid, session, now, market) {
  const today = zonedParts(now, session).day;
  const start = localToUtc(today, session.open, session);
  const end = start + session.rangeMinutes * 60_000;
  const sessionBars = valid.filter(c => c.timestamp >= start && c.timestamp < now);
  const opening = sessionBars.filter(c => c.timestamp < end);
  const label = { id: session.id, name: session.name, timeZone: session.timeZone,
    openingRangeStart: new Date(start).toISOString(), openingRangeEnd: new Date(end).toISOString() };
  if (now < end || opening.length < 6) return { ...label, status: "WAITING_FOR_OPENING_RANGE",
    direction: "HOLD", openingBars: opening.length };
  const rangeHigh=Math.max(...opening.map(c=>c.high)), rangeLow=Math.min(...opening.map(c=>c.low));
  const postRange=sessionBars.filter(c=>c.timestamp>=end);
  if (postRange.length < 2) return { ...label, status:"WAITING_FOR_BREAKOUT", direction:"HOLD",
    rangeHigh, rangeLow, reason:"Opening range formed; waiting for post-range candles." };
  const breakoutIndex=postRange.findIndex((c,i)=>{
    const baseline=avg(postRange.slice(Math.max(0,i-20),i).map(x=>x.volume));
    return baseline>0 && c.volume>=baseline*1.5 &&
      (c.close>rangeHigh || c.close<rangeLow);
  });
  if (breakoutIndex<0) return { ...label, status:"WAITING_FOR_BREAKOUT", direction:"HOLD",
    rangeHigh,rangeLow,reason:"No 1.5x-volume close beyond this session's opening range." };
  const breakout=postRange[breakoutIndex], direction=breakout.close>rangeHigh?"BUY":"SELL";
  const pullback=postRange.slice(breakoutIndex+1);
  if (!pullback.length) return { ...label,status:"WAITING_FOR_PULLBACK",direction:"HOLD",
    rangeHigh,rangeLow,breakoutAt:breakout.timestamp,reason:"Breakout detected; waiting for a pullback." };
  const vp=profile(sessionBars.filter(c=>c.timestamp>=start),24);
  if (!vp) return { ...label,status:"VOLUME_PROFILE_UNAVAILABLE",direction:"HOLD",
    rangeHigh,rangeLow,reason:"Insufficient usable session volume to calculate the profile." };
  const last=pullback.at(-1), body=Math.abs(last.close-last.open);
  const span=last.high-last.low;
  const lowerWick=Math.min(last.open,last.close)-last.low;
  const upperWick=last.high-Math.max(last.open,last.close);
  const baseline=avg(sessionBars.slice(-21,-1).map(c=>c.volume));
  const overlapsValueArea=last.low<=vp.vah && last.high>=vp.val;
  const absorption=direction==="BUY"
    ? lowerWick>=Math.max(body*1.2,span*0.2) && last.close>last.open && last.close>last.low+span*0.6
    : upperWick>=Math.max(body*1.2,span*0.2) && last.close<last.open && last.close<last.low+span*0.4;
  const volumeConfirmed=baseline>0 && last.volume>=baseline*1.1;
  const ready=overlapsValueArea && absorption && volumeConfirmed;
  return { ...label, status:ready?"READY":"WAITING_FOR_ABSORPTION_OR_RETEST",
    direction:ready?direction:"HOLD",market,rangeHigh,rangeLow,breakoutAt:breakout.timestamp,
    breakoutPrice:breakout.close,profile:{poc:vp.poc,val:vp.val,vah:vp.vah},
    pullbackAt:last.timestamp,absorptionProxy:absorption,
    pullbackVolumeConfirmed:volumeConfirmed,overlapsValueArea,
    reason:ready?"Session opening-range breakout, profile retest, volume and absorption proxy confirmed."
      :"Breakout exists, but profile retest and volume-backed absorption are not fully confirmed.",
    caveat:"Absorption is inferred from OHLCV candle shape and venue-specific volume; true bid/ask delta or footprint data is preferred." };
}
export function evaluateA1Heart({ candles = [], market = "UNKNOWN", now = Date.now() } = {}) {
  const valid = candles.filter(c => Number.isFinite(c.timestamp) &&
    [c.open,c.high,c.low,c.close].every(Number.isFinite) &&
    Number.isFinite(c.volume) && c.volume > 0).sort((a,b)=>a.timestamp-b.timestamp);
  if (valid.length < 30) return { status:"UNAVAILABLE",direction:"HOLD",
    reason:"Insufficient candles with positive volume; A1 requires a volume feed.",sessions:[] };
  const sessions=SESSIONS.map(session=>evaluateSession(valid,session,now,market));
  const ready=sessions.filter(s=>s.status==="READY")
    .sort((a,b)=>Date.parse(b.openingRangeEnd)-Date.parse(a.openingRangeEnd));
  if (ready.length) return { ...ready[0], sessions,
    strategy:"A1_HEART_MULTI_SESSION", selectedSession:ready[0].name };
  const completed=sessions.filter(s=>s.status!=="WAITING_FOR_OPENING_RANGE")
    .sort((a,b)=>Date.parse(b.openingRangeEnd)-Date.parse(a.openingRangeEnd));
  const selected=completed[0] ?? sessions[0];
  return { ...selected, sessions, strategy:"A1_HEART_MULTI_SESSION",
    selectedSession:selected.name,
    reason:selected.reason ?? "No session has a fully confirmed A1 HEART entry; waiting for the next valid setup." };
}
export const A1_HEART_SESSIONS = SESSIONS;
