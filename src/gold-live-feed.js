import WebSocket from "ws";
import { mkdir, appendFile, writeFile, readFile, rename } from "node:fs/promises";

const apiKey = process.env.TWELVE_DATA_API_KEY;
if (!apiKey) throw new Error("Set TWELVE_DATA_API_KEY in the hosting environment; never commit API keys.");
const symbols = (process.env.GOLD_LIVE_SYMBOLS || "XAU/USD,DXY").split(",").map(s => s.trim()).filter(Boolean);
const url = "wss://ws.twelvedata.com/v1/quotes/price?apikey=" + encodeURIComponent(apiKey);
const directory = process.env.GOLD_LIVE_DATA_DIR || "data";
const reconnectMax = 30_000;
let socket, reconnectTimer, heartbeatTimer, attempts = 0, stopping = false;

async function persistQuote(message) {
  const timestamp = Number(message.timestamp) * 1000;
  const price = Number(message.price);
  if (!message.symbol || !Number.isFinite(timestamp) || !Number.isFinite(price) || price <= 0) return;
  const quote = { symbol: String(message.symbol).toUpperCase(), timestamp, receivedAt: Date.now(), price, bid: Number.isFinite(Number(message.bid)) ? Number(message.bid) : null, ask: Number.isFinite(Number(message.ask)) ? Number(message.ask) : null, source: "Twelve Data WebSocket reference feed" };
  await mkdir(directory, { recursive: true });
  await appendFile(directory + "/gold-live-ticks.jsonl", JSON.stringify(quote) + "\n");
  let previous = {};
  try { previous = JSON.parse(await readFile(directory + "/gold-live-quotes.json", "utf8")); } catch {}
  previous[quote.symbol] = quote;
  await writeFile(directory + "/gold-live-quotes.json.tmp", JSON.stringify(previous, null, 2));
  await rename(directory + "/gold-live-quotes.json.tmp", directory + "/gold-live-quotes.json");
  console.log("GOLD LIVE TICK:", JSON.stringify(quote));
}
function scheduleReconnect() {
  if (stopping || reconnectTimer) return;
  const delay = Math.min(1000 * 2 ** attempts++, reconnectMax);
  reconnectTimer = setTimeout(() => { reconnectTimer = undefined; connect(); }, delay);
  console.error("Gold feed reconnect scheduled in", delay, "ms");
}
function connect() {
  if (stopping) return;
  socket = new WebSocket(url, { handshakeTimeout: 15_000 });
  socket.on("open", () => {
    attempts = 0;
    socket.send(JSON.stringify({ action: "subscribe", params: { symbols: symbols.join(",") } }));
    heartbeatTimer = setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ action: "heartbeat" })); }, 10_000);
    console.log("Twelve Data gold reference feed connected. Subscribing:", symbols.join(", "));
    console.log("Reference prices only; not Vantage quotes and not execution data.");
  });
  socket.on("message", raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.event === "price") void persistQuote(message).catch(error => console.error("Quote persistence error:", error.message));
    else if (message.event === "subscribe-status" || message.status === "error") console.log("GOLD FEED STATUS:", JSON.stringify(message));
  });
  socket.on("error", error => console.error("Gold feed socket error:", error.message));
  socket.on("close", () => { clearInterval(heartbeatTimer); scheduleReconnect(); });
}
function shutdown() { stopping = true; clearTimeout(reconnectTimer); clearInterval(heartbeatTimer); socket?.close(); process.exit(0); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
connect();
