export default {
  async fetch(request, env) {
    const allowed = new Set(["52.89.214.238","34.212.75.30","54.218.53.128","52.32.178.7"]);
    const url = new URL(request.url);
    const supplied = url.pathname.replace(/^\\/+|\\/+$/g, "");
    if (!env.TV_WEBHOOK_SECRET || supplied !== env.TV_WEBHOOK_SECRET) return new Response("Unauthorized", {status:401});
    if (request.method !== "POST") return new Response("Method not allowed", {status:405});
    if (!allowed.has(request.headers.get("CF-Connecting-IP"))) return new Response("Forbidden", {status:403});
    let p;
    try { p = await request.json(); } catch { return new Response("Invalid JSON", {status:400}); }
    if (!new Set(["OANDA:EURUSD","BINANCE:BTCUSDT","OANDA:XAUUSD"]).has(String(p.ticker||"").toUpperCase())) return new Response("Unsupported ticker",{status:400});
    const keys=["bar_time","timeframe_minutes","open","high","low","close","volume","ema20","ema50","rsi14","atr14"];
    if (keys.some(k=>!Number.isFinite(Number(p[k]))) || !["BUY","SELL","HOLD"].includes(String(p.action).toUpperCase())) return new Response("Invalid candle payload",{status:400});
    const res=await fetch("https://api.github.com/repos/"+env.GITHUB_REPOSITORY+"/dispatches",{
      method:"POST",
      headers:{"Accept":"application/vnd.github+json","Authorization":"Bearer "+env.GITHUB_TOKEN,"X-GitHub-Api-Version":"2022-11-28","User-Agent":"forex-sniper-tv-bridge","Content-Type":"application/json"},
      body:JSON.stringify({event_type:"tradingview_alert",client_payload:p})
    });
    if(!res.ok) return new Response("GitHub dispatch failed",{status:502});
    return new Response("Chart snapshot forwarded",{status:202});
  }
};
