export default {
  async fetch(request, env) {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return new Response("POST only", { status: 405, headers: cors });
    const suppliedPathSecret = new URL(request.url).pathname.split("/").filter(Boolean)[0] || "";
    const allowedTradingViewIps = new Set(["52.89.214.238", "34.212.75.30", "54.218.53.128", "52.32.178.7"]);
    const senderIp = request.headers.get("CF-Connecting-IP") || "";
    if (!env.TV_WEBHOOK_SECRET || suppliedPathSecret !== env.TV_WEBHOOK_SECRET || !allowedTradingViewIps.has(senderIp)) return new Response("Unauthorized", { status: 401, headers: cors });
    let alert;
    try { alert = await request.json(); } catch { return new Response("Invalid JSON", { status: 400, headers: cors }); }
    const action = String(alert.action || "").toUpperCase();
    const ticker = String(alert.ticker || "").toUpperCase();
    const timeframe = String(alert.timeframe || "");
    const price = Number(alert.price);
    if (!["BUY", "SELL"].includes(action) || !["EURUSD", "BTCUSDT", "XAUUSD", "GBPUSD", "USDJPY"].includes(ticker.replace(/[^A-Z0-9]/g, "")) || !Number.isFinite(price) || price <= 0 || !timeframe) {
      return new Response("Invalid alert fields", { status: 422, headers: cors });
    }
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY) return new Response("Worker is missing GitHub configuration", { status: 503, headers: cors });
    const response = await fetch("https://api.github.com/repos/" + env.GITHUB_REPOSITORY + "/dispatches", {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.GITHUB_TOKEN, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "forex-sniper-tradingview-bridge", "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: "tradingview_alert", client_payload: { source: "tradingview", ticker, action, price, timeframe, exchange: alert.exchange || "", rsi: Number(alert.rsi) || null, atr: Number(alert.atr) || null, bar_time: Number(alert.bar_time) || null, received_at: new Date().toISOString() } })
    });
    if (!response.ok) return new Response("GitHub dispatch failed: " + response.status, { status: 502, headers: cors });
    return new Response(JSON.stringify({ accepted: true, forwarded: true }), { headers: { ...cors, "Content-Type": "application/json" } });
  }
};
