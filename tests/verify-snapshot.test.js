import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const script = fileURLToPath(new URL("../scripts/verify-snapshot.js", import.meta.url));
const markets = [["EURUSD","EUR/USD SNIPER AI"],["BTCUSD","BTC/USD SNIPER AI"],["XAUUSD","XAU/USD (Gold) SNIPER AI"]];
function report(action) {
 return markets.map(([id,heading])=>[
  heading,
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
 assert.match(result.stdout,/no fresh quote is required to publish/);
});
test("never accepts BUY/SELL without a fresh independently approved quote",async()=>{
 const result=await run("BUY"); assert.notEqual(result.status,0);
 assert.match(result.stderr,/actionable BUY is missing an independently validated fresh bid\/ask quote/);
});
