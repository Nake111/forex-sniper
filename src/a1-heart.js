// A1 HEART: New York 30-minute opening-range breakout, volume confirmation,
// volume-profile pullback, and candle-based absorption proxy.
// Volume is venue-specific tick/contract volume; it is not consolidated FX volume.
const ZONE = "America/New_York";
const NY_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});
function nyParts(timestamp) {
  const parts = Object.fromEntries(NY_PARTS.formatToParts(new Date(timestamp))
    .filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return { day: parts.year + "-" + parts.month + "-" + parts.day,
    minute: Number(parts.hour) * 60 + Number(parts.minute) };
}
function avg(values) { return values.length ? values.reduce((a,b)=>a+b,0)/values.length : null; }
function profile(candles, bins = 24) {
  const valid = candles.filter(c => Number(c.volume) > 0 &&
    Number.isFinite(c.high) && Number.isFinite(c.low) && c.high >= c.low);
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
export function evaluateA1Heart({ candles = [], market = "UNKNOWN", now = Date.now() } = {}) {
  const valid = candles.filter(c => Number.isFinite(c.timestamp) &&
    [c.open,c.high,c.low,c.close].every(Number.isFinite) &&
    Number.isFinite(c.volume) && c.volume > 0).sort((a,b)=>a.timestamp-b.timestamp);
  if (valid.length < 30) return { status:"UNAVAILABLE", direction:"HOLD", reason:"Insufficient candles with positive volume; A1 requires a volume feed." };
  const today = nyParts(now).day;
  const todays = valid.filter(c=>nyParts(c.timestamp).day===today);
  const opening = todays.filter(c=>nyParts(c.timestamp).minute>=570 && nyParts(c.timestamp).minute<600);
  if (opening.length < 6 || nyParts(now).minute < 600)
    return { status:"WAITING_FOR_OPENING_RANGE", direction:"HOLD", reason:"Waiting for all six closed M5 candles in the 09:30–10:00 New York opening range.", openingBars:opening.length };
  const rangeHigh=Math.max(...opening.map(c=>c.high)), rangeLow=Math.min(...opening.map(c=>c.low));
  const postRange=todays.filter(c=>nyParts(c.timestamp).minute>=600);
  if (postRange.length < 2) return { status:"WAITING_FOR_BREAKOUT", direction:"HOLD", rangeHigh,rangeLow,reason:"Opening range formed; no post-range breakout yet." };
  const breakoutIndex=postRange.findIndex((c,i)=>{
    const baseline=avg(postRange.slice(Math.max(0,i-20),i).map(x=>x.volume));
    return baseline>0 && c.volume>=baseline*1.5 &&
      (c.close>rangeHigh || c.close<rangeLow);
  });
  if (breakoutIndex<0) return { status:"WAITING_FOR_BREAKOUT",direction:"HOLD",rangeHigh,rangeLow,reason:"No 1.5x-volume close beyond the opening range." };
  const breakout=postRange[breakoutIndex], direction=breakout.close>rangeHigh?"BUY":"SELL";
  const pullback=postRange.slice(breakoutIndex+1);
  if (!pullback.length) return {status:"WAITING_FOR_PULLBACK",direction:"HOLD",rangeHigh,rangeLow,breakoutAt:breakout.timestamp,reason:"Breakout detected; waiting for a pullback."};
  const vp=profile(todays.filter(c=>nyParts(c.timestamp).minute>=570),24);
  if (!vp) return {status:"VOLUME_PROFILE_UNAVAILABLE",direction:"HOLD",rangeHigh,rangeLow,reason:"Insufficient usable volume to calculate the session profile."};
  const last=pullback.at(-1), body=Math.abs(last.close-last.open);
  const lowerWick=Math.min(last.open,last.close)-last.low, upperWick=last.high-Math.max(last.open,last.close);
  const baseline=avg(todays.slice(-21,-1).map(c=>c.volume));
  const overlapsValueArea=last.low<=vp.vah && last.high>=vp.val;
  const absorption=direction==="BUY"
    ? lowerWick>=Math.max(body*1.2,(last.high-last.low)*0.2) && last.close>last.open && last.close>last.low+(last.high-last.low)*0.6
    : upperWick>=Math.max(body*1.2,(last.high-last.low)*0.2) && last.close<last.open && last.close<last.low+(last.high-last.low)*0.4;
  const volumeConfirmed=baseline>0 && last.volume>=baseline*1.1;
  const ready=overlapsValueArea && absorption && volumeConfirmed;
  return {
    status:ready?"READY":"WAITING_FOR_ABSORPTION_OR_RETEST",
    direction:ready?direction:"HOLD", market, rangeHigh,rangeLow,
    breakoutAt:breakout.timestamp, breakoutPrice:breakout.close,
    profile:{poc:vp.poc,val:vp.val,vah:vp.vah},
    pullbackAt:last.timestamp, absorptionProxy:absorption,
    pullbackVolumeConfirmed:volumeConfirmed, overlapsValueArea,
    reason:ready?"Opening-range breakout, profile retest, volume and absorption proxy confirmed."
      :"Breakout exists, but pullback into value area plus volume-backed absorption is not fully confirmed.",
    caveat:"Absorption is inferred from OHLCV candle shape and volume; true bid/ask delta or footprint data is preferred."
  };
}
