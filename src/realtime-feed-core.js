export function normalizeCoinbaseTicker(message, receivedAt = Date.now()) {
  if (message?.type !== "ticker" || message?.product_id !== "BTC-USD") return null;
  const bid = Number(message.best_bid), ask = Number(message.best_ask);
  if (!(Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > bid)) return null;
  const timestamp = Date.parse(message.time);
  return {
    market: "BTCUSD", symbol: "BTC/USD", bid, ask, price: (bid + ask) / 2,
    timestamp: Number.isFinite(timestamp) ? timestamp : receivedAt,
    receivedAt,
    timestampQuality: Number.isFinite(timestamp) ? "PROVIDER_TIMESTAMP" : "RECEIVED_AT_ONLY",
    source: "Coinbase Exchange BTC-USD ticker WebSocket", venue: "Coinbase", tradeable: true
  };
}

export function normalizeBiquoteStreamTick(payload, receivedAt = Date.now()) {
  const symbol = String(payload?.symbol ?? "").toUpperCase().replace("/", "");
  const market = symbol === "EURUSD" ? "EURUSD" : symbol === "XAUUSD" ? "XAUUSD" : null;
  const bid = Number(payload?.bid), ask = Number(payload?.ask);
  const timestamp = Date.parse(payload?.timestamp ?? payload?.lastQuoteAt ?? "");
  if (!market || !(Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > bid)) return null;
  if (!Number.isFinite(timestamp)) return null;
  return {
    market, symbol: market === "EURUSD" ? "EUR/USD" : "XAU/USD",
    bid, ask, price: Number(payload?.mid) || (bid + ask) / 2,
    timestamp, receivedAt, timestampQuality: "PROVIDER_TIMESTAMP",
    source: "Biquote MT5 SignalR live tick stream", venue: payload?.source ?? "Biquote",
    marketState: payload?.marketState ?? "open", stale: payload?.stale === true,
    tradeable: payload?.marketState === "open" && payload?.stale !== true
  };
}
