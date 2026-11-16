import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/verify-snapshot.js", import.meta.url));
const markets = [["EURUSD","EUR/USD SNIPER AI"],["BTCUSD","BTC/USD SNIPER AI"],["XAUUSD","XAU/USD (Gold) SNIPER AI"]];
const researchAgents = [
  { name:"hpFX multi-timeframe", signal:"NO_SIGNAL", direction:"NO_SIGNAL", reason:"fixture" },
  { name:"ICT/SMC structure", signal:"NO_SIGNAL", direction:"NO_SIGNAL", reason:"fixture" },
  { name:"FxTT market scanner", signal:"NO_SIGNAL", direction:"NO_SIGNAL", reason:"fixture" },
  { name:"Gann/Hurst trend", signal:"NO_SIGNAL", direction:"NO_SIGNAL", reason:"fixture" },
  { name:"Systematic breakout", signal:"NO_SIGNAL", direction:"NO_SIGNAL", reason:"fixture" }
];
const consensus = {
  direction:"NO_SIGNAL", approved:false, requiredVotes:3, totalAgents:5,
  counts:{ BUY:0, SELL:0, NO_SIGNAL:5 }
};
const framework = {
  status:"TRAINING_WINDOW_ONLY", totalClosedCandles:100,
  trainingRange:{startIndex:0,endIndexExclusive:70,count:70},
  holdoutRange:{startIndex:70,endIndexExclusive:100,count:30},
  holdoutAccess:"LOCKED_UNTIL_CANDIDATE_SETTINGS_FROZEN",
  optimizationApplied:false
};
function report(action) {
 return markets.map(([id,heading])=>[
  heading,
  "FIVE INDEPENDENT SIGNAL AGENTS: "+JSON.stringify(researchAgents),
  "FIVE-AGENT CONSENSUS: "+JSON.stringify(consensus),
  "FIVE-AGENT VALIDATION FRAMEWORK: "+JSON.stringify(framework),
  "AGENT 1 — BID/ASK + BUYER/SELLER REVIEW: "+JSON.stringify({approved:false,blockers:["no fresh quote"]}),
  "AGENT 2 — INDEPENDENT SIGNAL APPROVAL: "+JSON.stringify({approved:false,blockers:["no fresh quote"]}),
  "AGENT 3 — INDEPENDENT LIVE ENTRY VERIFICATION: "+JSON.stringify({agent:"LIVE_ENTRY_VERIFICATION_AGENT",approved:false,decision:"NO APPROVED TRADE",checkedAt:new Date().toISOString(),quoteValidationValid:false,quoteAgeMs:null,quote:null}),
  "FINAL "+id+" SIGNAL","FINAL ACTION: "+action
 ].join("\n")).join("\n");
}
async function run(action){
 const dir=await mkdtemp(join(tmpdir(),"forex-sniper-verify-")); const file=join(dir,"report.txt");
 try { await writeFile(file,report(action)); return spawnSync(process.execPath,[script,file],{encoding:"utf8"}); }
 finally { await rm(dir,{recursive:true,force:true}); }
}
test("publishes a fail-closed NO TRADE snapshot when a market has no fresh quote",async()=>{
 const result=await run("NO TRADE"); assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/final action NO TRADE/);
 assert.match(result.stdout,/holdout locked/);
});
test("never accepts BUY/SELL without a fresh independently approved quote",async()=>{
 const result=await run("BUY"); assert.notEqual(result.status,0);
 assert.match(result.stderr,/actionable BUY lacks independently validated provider-timestamped bid\/ask evidence/);
});
