export function normalizeBinanceBookTicker(message, receivedAt = Date.now()) {
  if (String(message?.s ?? "").toUpperCase() !== "BTCUSDT") return null;
  const bid = Number(message.b), ask = Number(message.a);
  if (!(Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > bid)) return null;
  return {
    market: "BTCUSD", symbol: "BTC/USD", bid, ask, price: (bid + ask) / 2,
    timestamp: receivedAt, receivedAt, timestampQuality: "RECEIVED_AT_ONLY",
    source: "Binance spot bookTicker WebSocket", venue: "Binance", tradeable: true
  };
}
