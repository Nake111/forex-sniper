const DIRECTIONS=new Set(["BUY","SELL"]), ACTUAL=new Set(["BUY","SELL","FLAT"]), MIN_SAMPLE=30;
const time=v=>{const n=typeof v==="number"?v:Date.parse(v);return Number.isFinite(n)?(n<1e12?n*1000:n):null};
const pct=(a,b)=>b?Number((100*a/b).toFixed(2)):null;
const mean=a=>a.length?Number((a.reduce((x,y)=>x+y,0)/a.length).toFixed(3)):null;
export function buildPhase2Intelligence(events=[],generatedAt=new Date().toISOString()){
 if(!Array.isArray(events))throw new Error("Phase 2 requires an event array");
 const outcomes=new Map(events.filter(e=>e.eventType==="AGENT_FORECAST_OUTCOME"&&e.forecastId).map(e=>[e.forecastId,e]));
 const forecasts=events.filter(e=>e.eventType==="AGENT_FORECAST"&&DIRECTIONS.has(e.predictedSide)&&time(e.forecastAt)!==null);
 const agents={};
 for(const name of [...new Set(forecasts.map(e=>e.agent))].sort()){
  const rows=forecasts.filter(e=>e.agent===name),resolved=rows.map(f=>({f,o:outcomes.get(f.eventId)})).filter(x=>x.o&&ACTUAL.has(x.o.actualDirection));
  const correct=resolved.filter(x=>x.f.predictedSide===x.o.actualDirection).length,byMarket={},byRegime={};
  for(const market of [...new Set(rows.map(x=>x.market))].sort()){const s=resolved.filter(x=>x.f.market===market),h=s.filter(x=>x.f.predictedSide===x.o.actualDirection).length;byMarket[market]={resolved:s.length,correct:h,accuracyPct:pct(h,s.length)}}
  for(const regime of [...new Set(rows.map(x=>x.regime||"UNKNOWN"))].sort()){const s=resolved.filter(x=>(x.f.regime||"UNKNOWN")===regime),h=s.filter(x=>x.f.predictedSide===x.o.actualDirection).length;byRegime[regime]={resolved:s.length,correct:h,accuracyPct:pct(h,s.length)}}
  agents[name]={forecasts:rows.length,resolved:resolved.length,pending:rows.length-resolved.length,correct,incorrect:resolved.length-correct,accuracyPct:pct(correct,resolved.length),falseDirectionalPct:pct(resolved.length-correct,resolved.length),byMarket,byRegime,qualification:resolved.length>=MIN_SAMPLE?"SAMPLE_THRESHOLD_MET_NOT_PROOF":"INSUFFICIENT_SAMPLE",votingWeight:0};
 }
 const groups=new Map();
 for(const f of forecasts){const k=[f.market,time(f.forecastAt)].join("|");if(!groups.has(k))groups.set(k,[]);groups.get(k).push(f)}
 const cycles=[...groups.entries()].map(([key,rows])=>{const resolved=rows.map(f=>({f,o:outcomes.get(f.eventId)})).filter(x=>x.o&&ACTUAL.has(x.o.actualDirection)),votes=rows.filter(x=>DIRECTIONS.has(x.predictedSide)),buy=votes.filter(x=>x.predictedSide==="BUY").length,sell=votes.filter(x=>x.predictedSide==="SELL").length,side=buy===sell?"SPLIT":buy>sell?"BUY":"SELL",actuals=[...new Set(resolved.map(x=>x.o.actualDirection))],actual=actuals.length===1?actuals[0]:actuals.length?"INCONSISTENT":null;return{market:rows[0].market,forecastAt:new Date(time(rows[0].forecastAt)).toISOString(),participatingAgents:rows.length,directionalVotes:votes.length,buyVotes:buy,sellVotes:sell,agreementPct:votes.length?pct(Math.max(buy,sell),votes.length):null,chiefDirection:side,resolvedAgents:resolved.length,realizedDirection:actual,consensusCorrect:actual&&actual!=="INCONSISTENT"&&side!=="SPLIT"?side===actual:null,disagreement:votes.length>1&&buy>0&&sell>0,authority:"NONE"}});
 cycles.sort((a,b)=>a.forecastAt.localeCompare(b.forecastAt));
 const resolvedCycles=cycles.filter(x=>x.consensusCorrect!==null),correctCycles=resolvedCycles.filter(x=>x.consensusCorrect).length;
 return{schemaVersion:1,generatedAt,mode:"FORWARD_PAPER_DIAGNOSTICS_ONLY",minimumResolvedForecastsForQualification:MIN_SAMPLE,agentScorecards:agents,chiefConsensus:{cycles:cycles.length,resolvedCycles:resolvedCycles.length,correctCycles,incorrectCycles:resolvedCycles.length-correctCycles,accuracyPct:pct(correctCycles,resolvedCycles.length),disagreementCycles:cycles.filter(x=>x.disagreement).length,averageAgreementPct:mean(cycles.map(x=>x.agreementPct).filter(Number.isFinite)),authority:"NONE",votingWeight:0,note:"Consensus accuracy is descriptive, not independent evidence of edge; correlated agents are not counted as independent votes."},recentCycles:cycles.slice(-100).reverse(),safeguards:{modifiesSignalWeights:false,modifiesApprovalGates:false,canApproveTrades:false,usesBacktestHoldout:false,brokerExecution:false,qualificationRule:"30 resolved forecasts per agent before labeling sample threshold met; never interpreted as proof of profitability."}};
}
