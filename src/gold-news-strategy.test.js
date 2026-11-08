import test from "node:test";
import assert from "node:assert/strict";
import { getGoldNewsWindow, evaluateGoldNewsCandle } from "./gold-news-strategy.js";
const minute=60_000, release=Date.UTC(2026,10,8,13,30);
const candle=(offset,open,high,low,close)=>({timestamp:release+offset*minute,open,high,low,close});
test("locks entries before a scheduled release",()=>{const s=getGoldNewsWindow([{name:"Consumer Price Index",timestamp:release}],release-10*minute);assert.equal(s.phase,"PRE_RELEASE_LOCK");assert.equal(s.blockNewEntries,true);});
test("locks the initial release reaction",()=>{const s=getGoldNewsWindow([{name:"Employment Situation / Nonfarm Payrolls",timestamp:release}],release+2*minute);assert.equal(s.phase,"RELEASE_LOCK");});
test("keeps post-release candidate analysis non-executable",()=>{const s=getGoldNewsWindow([{name:"FOMC rate decision",timestamp:release}],release+12*minute);assert.equal(s.phase,"POST_RELEASE_CONFIRMATION");assert.equal(s.blockNewEntries,true);});
test("detects a bullish breakout and retest",()=>{
 const bars=[candle(-30,1995,1998,1993,1996),candle(-25,1996,1999,1994,1997),candle(-20,1997,2000,1995,1998),candle(-15,1998,1999,1994,1996),candle(-10,1996,1998,1993,1995),candle(-5,1995,1997,1992,1996),candle(0,1996,2005,1995,2003),candle(5,2002,2007,1999.5,2005)];
 const r=evaluateGoldNewsCandle(bars,{name:"CPI",timestamp:release},release+10*minute);
 assert.equal(r.signal,"BUY");assert.ok(r.stopLoss<r.entry);assert.ok(r.takeProfit3>r.entry);assert.equal(r.executionStatus,"CANDIDATE_ONLY");
});
test("does not chase an unconfirmed spike",()=>{
 const bars=[candle(-30,1995,1998,1993,1996),candle(-25,1996,1999,1994,1997),candle(-20,1997,2000,1995,1998),candle(-15,1998,1999,1994,1996),candle(-10,1996,1998,1993,1995),candle(-5,1995,1997,1992,1996),candle(0,1996,2005,1995,2003),candle(5,2003,2007,2001,2002)];
 const r=evaluateGoldNewsCandle(bars,{name:"CPI",timestamp:release},release+10*minute);assert.equal(r.signal,"HOLD");
});