import WebSocket from "ws";

export const TWELVE_DATA_SYMBOLS = Object.freeze({
  EURUSD: "EUR/USD", BTCUSD: "BTC/USD", XAUUSD: "XAU/USD"
});

export function normalizeTwelveDataQuote(message, receivedAt = Date.now()) {
  const symbol = String(message?.symbol ?? "").toUpperCase();
  const market = Object.entries(TWELVE_DATA_SYMBOLS).find(([, value]) => value === symbol)?.[0];
  const timestamp = Number(message?.timestamp) * 1000;
  const price = Number(message?.price);
  const bid = message?.bid == null ? NaN : Number(message.bid);
  const ask = message?.ask == null ? NaN : Number(message.ask);
  if (!market || !Number.isFinite(timestamp) || !Number.isFinite(price) || price <= 0) return null;
  return { market, symbol, price, bid: Number.isFinite(bid) && bid > 0 ? bid : null,
    ask: Number.isFinite(ask) && ask > 0 ? ask : null, timestamp, receivedAt,
    exchange: message.exchange ?? null, instrumentType: message.type ?? null,
    source: "Twelve Data WebSocket (reference feed)" };
}

export function validateTwelveDataQuote(quote, { now = Date.now(), maxAgeMs = 15_000 } = {}) {
  if (!quote) return { valid: false, reason: "No Twelve Data quote received" };
  if (!Number.isFinite(quote.timestamp) || !Number.isFinite(quote.receivedAt))
    return { valid: false, reason: "Quote timestamp is missing or invalid" };
  const ageMs = now - quote.timestamp;
  const receiveAgeMs = now - quote.receivedAt;
  if (ageMs < -2_000 || receiveAgeMs < 0) return { valid: false, reason: "Quote timestamp is in the future" };
  if (ageMs > maxAgeMs || receiveAgeMs > maxAgeMs)
    return { valid: false, reason: "Quote is stale (provider age " + Math.round(ageMs) + " ms)" };
  if (!(Number.isFinite(quote.bid) && Number.isFinite(quote.ask) && quote.bid > 0 && quote.ask > quote.bid))
    return { valid: false, reason: "Provider did not supply a valid bid/ask spread" };
  return { valid: true, ageMs: Math.max(0, ageMs), spread: quote.ask - quote.bid };
}

export async function fetchTwelveDataQuotes({
  apiKey = process.env.TWELVE_DATA_API_KEY, timeoutMs = 8_000, WebSocketImpl = WebSocket
} = {}) {
  if (!apiKey) return { status: "NOT_CONFIGURED", quotes: {}, errors: ["TWELVE_DATA_API_KEY secret is not configured"] };
  return new Promise(resolve => {
    const quotes = {}, errors = [];
    let socket, heartbeat, timeout, settled = false;
    const finish = status => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(heartbeat);
      if (socket && socket.readyState < WebSocketImpl.CLOSING) socket.close();
      resolve({ status, quotes, errors, provider: "Twelve Data", receivedAt: Date.now() });
    };
    try {
      const url = "wss://ws.twelvedata.com/v1/quotes/price?apikey=" + encodeURIComponent(apiKey);
      socket = new WebSocketImpl(url, { handshakeTimeout: 5_000 });
      timeout = setTimeout(() => finish(Object.keys(quotes).length ? "PARTIAL" : "TIMEOUT"), timeoutMs);
      socket.on("open", () => {
        socket.send(JSON.stringify({ action: "subscribe", params: { symbols: Object.values(TWELVE_DATA_SYMBOLS).join(",") } }));
        heartbeat = setInterval(() => {
          if (socket?.readyState === WebSocketImpl.OPEN) socket.send(JSON.stringify({ action: "heartbeat" }));
        }, 10_000);
      });
      socket.on("message", raw => {
        let message;
        try { message = JSON.parse(raw.toString()); } catch { errors.push("Ignored malformed WebSocket message"); return; }
        if (message.event === "price") {
          const quote = normalizeTwelveDataQuote(message);
          if (quote) quotes[quote.market] = quote;
          if (Object.keys(quotes).length === Object.keys(TWELVE_DATA_SYMBOLS).length) finish("COMPLETE");
        } else if (message.event === "subscribe-status") {
          for (const failure of message.fails ?? [])
            errors.push("Subscription failed for " + (failure.symbol ?? "unknown symbol") + ": " + (failure.message ?? failure.code ?? "not available"));
          if (!(message.success ?? []).length && (message.fails ?? []).length) finish("SUBSCRIPTION_FAILED");
        } else if (message.status === "error" || message.event === "error") {
          errors.push(message.message ?? message.code ?? "Provider returned an error");
          finish("ERROR");
        }
      });
      socket.on("error", error => { errors.push(error.message); finish("ERROR"); });
      socket.on("close", (code, reason) => {
        if (!settled) {
          errors.push("WebSocket closed (" + code + "): " + (reason?.toString?.() ?? ""));
          finish(Object.keys(quotes).length ? "PARTIAL" : "DISCONNECTED");
        }
      });
    } catch (error) { errors.push(error.message); finish("ERROR"); }
  });
}
