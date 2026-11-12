(() => {
  const FEED_URL = "https://raw.githubusercontent.com/Nake111/forex-sniper/main/dashboard/data/latest.json";
  const main = document.querySelector("main");
  if (!main) return;
  const section = document.createElement("section");
  section.className = "panel";
  section.style.cssText = "margin-top:4px;overflow-x:auto";
  section.innerHTML = '<div class="row"><div><h2 style="margin-bottom:4px">Forex Sniper · Published market candles</h2><div class="muted" id="published-feed-status">Connecting to repository candle feed…</div></div><span class="pill" id="published-feed-badge">LOADING</span></div><div id="published-feed-table" style="overflow-x:auto;margin-top:12px"></div>';
  const footer = main.querySelector(".foot");
  main.insertBefore(section, footer || null);
  const status = section.querySelector("#published-feed-status");
  const badge = section.querySelector("#published-feed-badge");
  const table = section.querySelector("#published-feed-table");
  function cell(row, value, bold=false) {
    const td=document.createElement("td"); td.textContent=value;
    td.style.cssText="padding:9px 10px;border-bottom:1px solid #1b283a;white-space:nowrap"+(bold?";font-weight:700":"");
    row.appendChild(td);
  }
  function render(data) {
    table.replaceChildren();
    const tbl=document.createElement("table");
    tbl.style.cssText="width:100%;border-collapse:collapse;font-size:12px;text-align:right";
    const head=document.createElement("tr");
    ["Market","TF","Last closed (UTC)","Age","Open","High","Low","Close","Source","Check"].forEach((v,i)=>cell(head,v,i<2));
    tbl.appendChild(head);
    let warn=false;
    for(const [symbol,market] of Object.entries(data.markets||{})) {
      for(const [tf,item] of Object.entries(market.timeframes||{})) {
        const row=document.createElement("tr");
        cell(row,market.label,true); cell(row,tf,true);
        cell(row,new Date(item.latestClosedAt).toLocaleString());
        const candleAgeSeconds=Math.max(0,Math.floor((Date.now()-Date.parse(item.latestClosedAt))/1000));
        const stale=!Number.isFinite(candleAgeSeconds)||candleAgeSeconds>Number(item.maxAgeSeconds??0);
        cell(row,Math.round(candleAgeSeconds/60)+" min"+(stale?" · STALE":""));
        for(const key of ["open","high","low","close"]) cell(row,Number(item.latest[key]).toLocaleString(undefined,{maximumFractionDigits:5}));
        cell(row,item.source||"unknown");
        cell(row,item.status+(item.gapCount?" · gaps "+item.gapCount:""));
        if(item.status!=="PASS"||stale) warn=true;
        tbl.appendChild(row);
      }
    }
    table.appendChild(tbl);
    badge.textContent=warn||data.validation?.status!=="PASS"?"CHECK DATA":"VALIDATED";
    badge.className="pill "+(warn?"":"live");
    const snapshotAge=Math.max(0,Math.floor((Date.now()-Date.parse(data.generatedAt))/1000));
    status.textContent="Snapshot "+Math.round(snapshotAge/60)+" min old · "+new Date(data.generatedAt).toLocaleString()+" · 5-minute workflow target · candle ages update live";
  }
  async function refresh() {
    try {
      const response=await fetch(FEED_URL+"?_="+Date.now(),{cache:"no-store"});
      if(!response.ok) throw new Error("HTTP "+response.status);
      const data=await response.json();
      if(data.schemaVersion!==1||!data.markets) throw new Error("Unsupported or incomplete snapshot");
      render(data);
    } catch(error) {
      badge.textContent="FEED OFFLINE";
      status.textContent="Cannot load published candles: "+error.message+". Waiting for next successful refresh.";
    }
  }
  refresh(); setInterval(refresh,30000);

  const signalSection=document.createElement("section");
  signalSection.className="panel";
  signalSection.style.cssText="margin-top:4px";
  signalSection.innerHTML='<div class="row"><div><h2 style="margin-bottom:4px">Forex Sniper · Approved paper signals</h2><div class="muted" id="signal-feed-status">Waiting for verified signal publication…</div></div><span class="pill" id="signal-feed-badge">WAITING</span></div><div id="signal-feed-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:12px"></div>';
  main.insertBefore(signalSection,footer||null);
  const signalStatus=signalSection.querySelector("#signal-feed-status");
  const signalBadge=signalSection.querySelector("#signal-feed-badge");
  const signalCards=signalSection.querySelector("#signal-feed-cards");
  async function refreshSignals(){
    try{
      const response=await fetch("https://raw.githubusercontent.com/Nake111/forex-sniper/main/dashboard/data/signals.json?_="+Date.now(),{cache:"no-store"});
      if(!response.ok)throw new Error("No verified signal snapshot published (HTTP "+response.status+")");
      const data=await response.json();
      if(data.schemaVersion!==1||!data.markets)throw new Error("Invalid signal snapshot");
      const age=Date.now()-Date.parse(data.generatedAt);
      if(!Number.isFinite(age)||age< -60000||age>10*60*1000)throw new Error("Signal snapshot is stale");
      signalCards.replaceChildren();
      let approved=0;
      for(const [symbol,item] of Object.entries(data.markets)){
        const card=document.createElement("div");
        card.style.cssText="border:1px solid #223047;border-radius:10px;padding:12px;background:#0a1321";
        const title=document.createElement("div");title.textContent=item.label||symbol;title.style.cssText="font-weight:700;margin-bottom:8px";
        const decision=document.createElement("div");decision.textContent=item.decision||"NO APPROVED TRADE";decision.style.cssText="font-size:21px;font-weight:850;color:"+(item.status==="PAPER_SIGNAL_APPROVED"?(item.decision==="BUY"?"#35d49a":"#ff647c"):"#f4bd58");
        const details=document.createElement("div");details.style.cssText="font-size:11px;color:#8291a8;margin-top:8px;white-space:pre-line";
        const strength=item.candidateStrength
          ?"Candidate strength "+item.candidateStrength.score+"/"+item.candidateStrength.maxScore+
            " · Evidence coverage "+(item.candidateStrength.evidenceCoveragePct??"—")+"% · Not probability"
          :"Candidate "+(item.candidate||"unknown");
        const planText=item.status==="PAPER_SIGNAL_APPROVED"
          ?"Entry "+item.entry+" ("+(item.candidatePlan?.entryReference??"quote")+") · SL "+item.stopLoss+" · TP "+item.takeProfit+" · R:R "+item.riskReward
          :strength+"\\n"+((item.verification?.blockers||[]).slice(0,3).join("; ")||"Independent approval not passed");
        details.textContent=planText;
        const quote=document.createElement("div");quote.style.cssText="font-size:10px;color:#8291a8;margin-top:8px";
        quote.textContent="Bid "+(item.quote?.bid??"—")+" / Ask "+(item.quote?.ask??"—")+" · "+(item.quote?.ageMs??"—")+"ms · "+(item.quote?.source??"unknown");
        const broker=document.createElement("div");broker.style.cssText="font-size:10px;color:#8291a8;margin-top:6px";
        broker.textContent="Broker execution: "+(item.brokerExecution?.status??"disabled")+" · no orders sent";
        card.append(title,decision,details,quote,broker);
        if(item.status==="PAPER_SIGNAL_APPROVED")approved++;
      }
      signalBadge.textContent=approved?"APPROVED PAPER SIGNAL":"NO APPROVED TRADE";
      signalBadge.className="pill "+(approved?"live":"");
      signalStatus.textContent="Verified snapshot "+new Date(data.generatedAt).toLocaleString()+" · "+Math.round(age/1000)+"s old · research only, no broker orders";
    }catch(error){
      signalBadge.textContent="SIGNAL FEED UNAVAILABLE";
      signalBadge.className="pill";
      signalStatus.textContent=error.message+" · Fail-closed: no signal is shown as approved.";
      signalCards.replaceChildren();
    }
  }
  refreshSignals();setInterval(refreshSignals,30000);

})();
