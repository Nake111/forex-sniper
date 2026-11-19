(() => {
  "use strict";
  const FEED_URL = "https://raw.githubusercontent.com/Nake111/forex-sniper/main/dashboard/data/signals.json";
  const main = document.querySelector("main");
  if (!main) return;

  const style = document.createElement("style");
  style.textContent = `
    .qd-wrap{margin-top:4px}.qd-head{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}
    .qd-tabs{display:flex;gap:7px;flex-wrap:wrap;margin:14px 0}
    .qd-tab{border:1px solid #2a3b54;background:#0b1422;color:#aebbd0;padding:7px 12px;border-radius:8px;cursor:pointer;font-weight:700}
    .qd-tab[aria-pressed=true]{background:#17352f;border-color:#28765b;color:#8af0c2}
    .qd-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}
    .qd-agent{background:#0a1321;border:1px solid #223047;border-radius:10px;padding:12px;min-width:0}
    .qd-agent.qd-chief{border-color:#3a5275;background:linear-gradient(145deg,#14233a,#0a1321)}
    .qd-agent h3{font-size:11px;letter-spacing:.12em;margin:0 0 8px;color:#a9bddb}
    .qd-state{font-size:11px;font-weight:800;letter-spacing:.04em;margin-bottom:7px}
    .qd-detail{font-size:11px;color:#a1aec2;line-height:1.45;overflow-wrap:anywhere}
    .qd-evidence{font-size:10px;color:#71839e;margin-top:8px;overflow-wrap:anywhere}
    .qd-topline{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin:12px 0}
    .qd-stat{background:#0a1321;border:1px solid #1d2c42;border-radius:9px;padding:10px}
    .qd-stat b{display:block;font-size:16px;margin-top:4px}
    .qd-warning{font-size:11px;color:#f4bd58;margin-top:12px;border-top:1px solid #223047;padding-top:10px}
    @media(max-width:850px){.qd-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.qd-topline{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:480px){.qd-grid{grid-template-columns:1fr}.qd-topline{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  document.head.append(style);

  const section = document.createElement("section");
  section.className = "panel qd-wrap";
  section.innerHTML = '<div class="qd-head"><div><h2 style="margin:0 0 4px">EIGHT-AGENT QUANT DESK</h2><div class="muted" id="qd-status">Waiting for the next verified signal snapshot…</div></div><span class="pill" id="qd-badge">CONNECTING</span></div><div class="qd-tabs" id="qd-tabs" role="group" aria-label="Select market"></div><div class="qd-topline" id="qd-stats"></div><div class="qd-grid" id="qd-agents"></div><div class="qd-warning" id="qd-safety">Research-only diagnostics · zero signal weight · no order authority.</div>';
  const footer = main.querySelector(".foot");
  main.insertBefore(section, footer || null);

  const statusEl = section.querySelector("#qd-status");
  const badge = section.querySelector("#qd-badge");
  const tabs = section.querySelector("#qd-tabs");
  const stats = section.querySelector("#qd-stats");
  const cards = section.querySelector("#qd-agents");
  const safety = section.querySelector("#qd-safety");
  let snapshot = null;
  let selected = "BTCUSD";

  const labels = { EURUSD:"EUR/USD", BTCUSD:"BTC/USD", XAUUSD:"XAU/USD" };
  const el = (tag, cls, value) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (value !== undefined) node.textContent = String(value);
    return node;
  };
  function stat(label, value, color) {
    const box = el("div","qd-stat");
    box.append(el("div","label",label));
    const b = el("b","",value);
    if (color) b.style.color = color;
    box.append(b);
    return box;
  }
  function evidenceText(value) {
    if (value === null || value === undefined) return "No verified evidence supplied";
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch { return "Evidence unavailable"; }
  }
  function renderTabs(markets) {
    tabs.replaceChildren();
    for (const key of ["BTCUSD","EURUSD","XAUUSD"]) {
      const button = el("button","qd-tab",labels[key]);
      button.type = "button";
      button.setAttribute("aria-pressed",String(selected === key));
      button.addEventListener("click",() => { selected = key; render(); });
      tabs.append(button);
    }
  }
  function render() {
    if (!snapshot) return;
    const market = snapshot.markets?.[selected];
    renderTabs(snapshot.markets || {});
    stats.replaceChildren();
    cards.replaceChildren();
    if (!market) {
      badge.textContent = "NO MARKET DATA";
      statusEl.textContent = "The selected market is missing from this snapshot. No agent result is inferred.";
      return;
    }
    const desk = market.quantDesk;
    if (!desk || !Array.isArray(desk.roles) || !desk.chief) {
      badge.textContent = "DESK DATA PENDING";
      statusEl.textContent = labels[selected] + " has no eight-agent report in this publication cycle.";
      cards.append(el("div","qd-agent qd-detail","No desk output published. The dashboard will not fabricate agent states."));
      return;
    }
    const roles = desk.roles;
    const chief = desk.chief;
    const warnings = roles.filter(x => ["BLOCKED","RISK_WARNING","WAITING_FOR_M5","NO_VERIFIED_FLOW_FEED","SENTIMENT_UNVERIFIED"].includes(x.status)).length;
    stats.append(
      stat("DIRECTIONAL CANDIDATE",desk.chief.researchDirection || market.candidate || "UNKNOWN"),
      stat("SPECIALIST ROLES",roles.length + " / 7"),
      stat("RESEARCH WARNINGS",warnings,warnings ? "#f4bd58" : "#35d49a"),
      stat("SIGNAL WEIGHT","0 · NO VOTE","#72a7ff")
    );
    for (const role of roles) {
      const card = el("article","qd-agent");
      const head = el("h3","",role.name);
      const state = el("div","qd-state",role.status.replaceAll("_"," "));
      state.style.color = ["BLOCKED","RISK_WARNING","WAITING_FOR_M5","NO_VERIFIED_FLOW_FEED","SENTIMENT_UNVERIFIED"].includes(role.status) ? "#f4bd58" :
        ["CHECKS_PASSED","TRIGGER_CONFIRMED","SHORTLISTED"].includes(role.status) ? "#35d49a" : "#72a7ff";
      card.append(head,state,el("div","qd-detail",role.detail || "No detail supplied"));
      card.append(el("div","qd-evidence",evidenceText(role.evidence)));
      cards.append(card);
    }
    const chiefCard = el("article","qd-agent qd-chief");
    chiefCard.append(el("h3","","CHIEF · SUPERVISOR"));
    chiefCard.append(el("div","qd-state",chief.status.replaceAll("_"," ")));
    chiefCard.append(el("div","qd-detail",chief.detail));
    chiefCard.append(el("div","qd-evidence","Blocked / warning roles: "+(chief.blockedRoles?.join(", ") || "None reported")));
    chiefCard.append(el("div","qd-evidence","Approval authority: NO · Order authority: NO · Signal weight: 0"));
    cards.append(chiefCard);
    const paperApproved = market.paperApproval?.approved === true;
    safety.textContent = "RESEARCH ONLY · Desk authority: none · Signal weight: 0 · Broker orders: disabled. Existing independent approval result: " +
      (paperApproved ? "APPROVED PAPER SIGNAL " + market.paperApproval.decision : "NO APPROVED TRADE") +
      ". A candidate or agent consensus is not a trade instruction.";
    badge.textContent = "REPORT LOADED · RESEARCH ONLY";
    badge.className = "pill live";
    statusEl.textContent = labels[selected] + " · cycle " + (snapshot.analysisCycle?.timestampSlovenia || snapshot.generatedAtSlovenia || snapshot.generatedAt) +
      " · published " + new Date(snapshot.generatedAt).toLocaleString();
  }
  async function refresh() {
    try {
      const response = await fetch(FEED_URL + "?_=" + Date.now(),{cache:"no-store"});
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      const age = Date.now() - Date.parse(data.generatedAt);
      if (data.schemaVersion !== 1 || !data.markets || !Number.isFinite(age) || age < -60000 || age > 10*60*1000) {
        throw new Error("Signal snapshot is invalid, future-dated or stale");
      }
      snapshot = data;
      if (!snapshot.markets[selected]) selected = "BTCUSD";
      render();
    } catch (error) {
      snapshot = null;
      badge.textContent = "FEED UNAVAILABLE";
      badge.className = "pill";
      statusEl.textContent = error.message + " · Agent cards hidden until a fresh verified snapshot arrives.";
      stats.replaceChildren();
      cards.replaceChildren();
      safety.textContent = "FAIL-CLOSED · No live agent state available. No signals or approvals are inferred.";
    }
  }
  refresh();
  setInterval(refresh,30000);
})();