import test from "node:test";
import assert from "node:assert/strict";
import { assessCandleVolume, assessQuoteCandleBasis } from "./market-data-quality.js";

test("does not treat zero or missing candle volume as usable volume",()=>{
 const result=assessCandleVolume([{volume:0},{},{volume:"0"}]);
 assert.equal(result.status,"UNAVAILABLE");
 assert.equal(result.usableForVolumeProfile,false);
 assert.equal(result.coveragePct,0);
});
test("marks partially reported candle volume honestly",()=>{
 const result=assessCandleVolume([{volume:10},{volume:0},{volume:5}]);
 assert.equal(result.status,"PARTIAL");
 assert.equal(result.usableForVolumeProfile,false);
 assert.equal(result.coveragePct,66.67);
});
test("marks complete positive volume as available",()=>{
 const result=assessCandleVolume([{volume:10},{volume:5}]);
 assert.equal(result.status,"REPORTED");
 assert.equal(result.usableForVolumeProfile,true);
});
test("reports venue/source mismatch and quote-candle divergence without hiding it",()=>{
 const result=assessQuoteCandleBasis({
  quote:{bid:1.1000,ask:1.1002,venue:"Broker MT5",source:"Broker quote"},
  candle:{close:1.0990,source:"Twelve Data"},atr:0.001
 });
 assert.equal(result.sourceLabelsDiffer,true);
 assert.equal(result.status,"DIVERGENCE_REVIEW");
 assert.equal(result.differenceAtr,1.1);
 assert.equal(result.diagnosticOnly,true);
});
test("returns unavailable when quote or ATR is missing",()=>{
 const result=assessQuoteCandleBasis({quote:null,candle:{close:1},atr:null});
 assert.equal(result.status,"UNAVAILABLE");
 assert.equal(result.differenceAtr,null);
});
