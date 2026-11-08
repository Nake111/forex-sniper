import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDonchianSignal, donchianTradePlan } from "./donchian-strategy.js";

const base = { close:110, previousClose:99, ema20:105, ema50:102, ema200:100, rsi14:60, atr14:2, adx14:25, channelHigh20:108, channelLow20:90, previousChannelHigh20:100, previousChannelLow20:95, volumeRatio:1.5 };
test("Donchian long requires breakout, aligned H1 trend, volume and momentum filters",()=>{
  assert.equal(evaluateDonchianSignal({M5:base,M15:base,H1:base}),"BUY");
});
test("No breakout means HOLD",()=>{
  assert.equal(evaluateDonchianSignal({M5:base,M15:{...base,close:107},H1:base}),"HOLD");
});
test("Weak ADX blocks breakout",()=>{
  assert.equal(evaluateDonchianSignal({M5:base,M15:{...base,adx14:12},H1:base}),"HOLD");
});
test("Low relative volume blocks breakout",()=>{
  assert.equal(evaluateDonchianSignal({M5:base,M15:{...base,volumeRatio:0.9},H1:base}),"HOLD");
});
test("Opposing H1 trend blocks long",()=>{
  assert.equal(evaluateDonchianSignal({M5:base,M15:base,H1:{...base,ema50:98}}),"HOLD");
});
test("Donchian short requires downside breakout and aligned H1 trend",()=>{
  const short={...base,close:80,previousClose:96,ema20:85,ema50:90,ema200:100,rsi14:40,channelHigh20:110,channelLow20:85,previousChannelHigh20:105,previousChannelLow20:90};
  assert.equal(evaluateDonchianSignal({M5:short,M15:short,H1:short}),"SELL");
});
test("Trade plan uses ATR-based 1:1.5 levels",()=>{
  const p=donchianTradePlan("BUY",{close:100,atr14:2});
  assert.equal(p.entry,100); assert.equal(p.stopLoss,96); assert.equal(p.takeProfit,106);
  assert.equal(p.riskReward,"1:1.5");
});
test("HOLD cannot create a plan",()=>{
  assert.equal(donchianTradePlan("HOLD",{close:100,atr14:2}),null);
});
