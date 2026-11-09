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
})();
