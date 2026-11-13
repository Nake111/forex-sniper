(() => {
  "use strict";
  const FEED = "https://btc-10-second-feed-production.up.railway.app";
  const MAX_AGE_MS = 15000;
  const main = document.querySelector("main");
  if (!main) return;

  const section = document.createElement("section");
  section.className = "panel";
  section.style.cssText = "margin-top:4px;overflow-x:auto";
  section.innerHTML = `
    <div class="row">
      <div>
        <h2 style="margin-bottom:4px">Live prices · EUR/USD · BTC/USD · XAU/USD</h2>
        <div id="sniper-live-status" class="muted">Connecting to Railway live quote stream…</div>
      </div>
      <span id="sniper-live-badge" class="pill">CONNECTING</span>
    </div>
    <div style="overflow-x:auto;margin-top:12px">
      <table style="width:100%;border-collapse:collapse;text-align:right;font-size:12px">
        <thead><tr>
          <th style="text-align:left;padding:9px 10px">Market</th>
          <th style="padding:9px 10px">Bid</th>
          <th style="padding:9px 10px">Ask</th>
          <th style="padding:9px 10px">Spread</th>
          <th style="padding:9px 10px">Quote age</th>
          <th style="padding:9px 10px">Provider</th>
          <th style="padding:9px 10px">Status</th>
        </tr></thead>
        <tbody id="sniper-live-rows"></tbody>
      </table>
    </div>
    <div style="font-size:10px;color:#8291a8;margin-top:10px">
      Prices update from provider ticks. Indicators and entry decisions still require fresh, closed candles and independent approval.
      PAPER / RESEARCH ONLY · No broker orders.
    </div>`;
  main.insertBefore(section, main.querySelector(".foot") || null);

  const statusEl = section.querySelector("#sniper-live-status");
  const badgeEl = section.querySelector("#sniper-live-badge");
  const rowsEl = section.querySelector("#sniper-live-rows");
  const labels = { EURUSD: "EUR/USD", BTCUSD: "BTC/USD", XAUUSD: "XAU/USD" };
  const quotes = Object.create(null);
  const fmt = (value, market) => {
    if (!Number.isFinite(Number(value))) return "—";
    const digits = market === "EURUSD" ? 5 : market === "XAUUSD" ? 3 : 2;
    return Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  function render() {
    rowsEl.replaceChildren();
    let fresh = 0;
    for (const market of Object.keys(labels)) {
      const quote = quotes[market];
      const age = quote ? Date.now() - Number(quote.timestamp) : Infinity;
      const valid = quote && Number.isFinite(age) && age >= 0 && age <= MAX_AGE_MS &&
        Number(quote.bid) > 0 && Number(quote.ask) > Number(quote.bid) &&
        quote.timestampQuality === "PROVIDER_TIMESTAMP";
      if (valid) fresh++;
      const tr = document.createElement("tr");
      const values = [
        labels[market],
        quote ? fmt(quote.bid, market) : "—",
        quote ? fmt(quote.ask, market) : "—",
        quote ? fmt(Number(quote.ask) - Number(quote.bid), market) : "—",
        quote && Number.isFinite(age) ? Math.max(0, Math.round(age)) + " ms" : "—",
        quote?.source || "—",
        valid ? "FRESH" : quote ? "STALE / INVALID" : "WAITING"
      ];
      values.forEach((value, index) => {
        const td = document.createElement("td");
        td.textContent = value;
        td.style.cssText = "padding:10px;border-bottom:1px solid #1b283a;white-space:nowrap" +
          (index === 0 ? ";text-align:left;font-weight:700" : "") +
          (index === 6 ? ";font-weight:800;color:" + (valid ? "#35d49a" : "#f4bd58") : "");
        tr.appendChild(td);
      });
      rowsEl.appendChild(tr);
    }
    badgeEl.textContent = fresh === 3 ? "3 / 3 LIVE" : fresh + " / 3 LIVE";
    badgeEl.className = "pill" + (fresh === 3 ? " live" : "");
    statusEl.textContent = fresh === 3
      ? "All three provider quotes are fresh · age limit 15 seconds"
      : "Waiting for fresh provider quotes · " + fresh + " of 3 markets currently fresh";
  }

  function accept(event) {
    try {
      const payload = JSON.parse(event.data);
      if (payload.market && payload.quote && labels[payload.market]) {
        quotes[payload.market] = payload.quote;
        render();
      }
    } catch {}
  }

  function connect() {
    const stream = new EventSource(FEED + "/stream");
    stream.addEventListener("quote", accept);
    stream.addEventListener("heartbeat", () => {
      statusEl.textContent = "Connected to Railway quote stream · validating provider timestamps";
    });
    stream.onopen = () => {
      badgeEl.textContent = "CONNECTED";
      badgeEl.className = "pill live";
    };
    stream.onerror = () => {
      badgeEl.textContent = "RECONNECTING";
      badgeEl.className = "pill";
      statusEl.textContent = "Live stream disconnected · browser is retrying automatically";
    };
  }

  // The stream supplies every tick; this timer only refreshes the displayed quote age.
  setInterval(render, 1000);
  connect();
  render();
})();