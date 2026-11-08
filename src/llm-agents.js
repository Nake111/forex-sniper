// Six independent Gemini research agents. No paid Grok/xAI dependency.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const API_BASE = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 15000);
const REQUEST_INTERVAL_MS = Number(process.env.GEMINI_REQUEST_INTERVAL_MS || 6500);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let nextRequestAt = 0;
async function paceRequest(intervalMs) {
  if (intervalMs <= 0) return;
  const now = Date.now();
  const delayMs = Math.max(0, nextRequestAt - now);
  nextRequestAt = Math.max(now, nextRequestAt) + intervalMs;
  if (delayMs > 0) await wait(delayMs);
}
const ROLES = [
  ["technical", "You are an independent technical analyst. Assess trend, momentum, volatility and timeframe alignment."],
  ["market_structure", "You are an independent market-structure analyst. Assess swings, breakouts, liquidity sweeps and support/resistance."],
  ["quant", "You are an independent quantitative analyst. Assess return distribution, volatility, Bayesian probability and uncertainty."],
  ["macro", "You are an independent macro analyst. Assess only supplied news and macro fields; never invent events."],
  ["risk", "You are an independent risk officer. Look for reasons not to trade, data staleness, event risk and poor reward/risk."],
  ["contrarian", "You are an independent adversarial reviewer. Challenge the proposed direction and identify missing evidence."]
];
function parseJson(text) {
  const start = String(text || "").indexOf("{");
  const end = String(text || "").lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Agent did not return JSON");
  return JSON.parse(String(text).slice(start, end + 1));
}
async function runOne(role, system, context, apiKey, requestIntervalMs, retryCount, retryBaseDelayMs) {
  const endpoint = API_BASE.replace(/\/$/, "") + "/models/" + encodeURIComponent(MODEL) + ":generateContent";
  const requestBody = JSON.stringify({
    systemInstruction: { parts: [{ text: system + ' Return exactly one valid JSON object: {"direction":"BUY|SELL|HOLD","confidence":75,"evidence":["short evidence"],"veto":false}. Do not give guarantees or invent data.' }] },
    contents: [{ role: "user", parts: [{ text: JSON.stringify(context) }] }],
    generationConfig: { maxOutputTokens: 350, responseMimeType: "application/json" }
  });
  let response;
  const startedAt = Date.now();
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    await paceRequest(requestIntervalMs);
    if (attempt === 0) console.log("Gemini agent", role, "started using", MODEL);
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: requestBody,
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (error) {
      if (attempt >= retryCount) throw error;
      const delay = retryBaseDelayMs * (2 ** attempt);
      console.warn("Gemini agent", role, "network error; retry", attempt + 1, "after", delay, "ms:", error.message);
      if (delay > 0) await wait(delay);
      continue;
    }
    if (response.ok) break;
    const status = response.status;
    const detail = await response.text().catch(() => "");
    const retryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
    if (!retryable || attempt >= retryCount) {
      throw new Error("Gemini HTTP " + status + (detail ? ": " + detail.slice(0, 320) : ""));
    }
    let retryDelayMs = 0;
    try {
      const body = JSON.parse(detail);
      const retryInfo = body.error?.details?.find(item => item["@type"]?.includes("RetryInfo"));
      const retryDelay = retryInfo?.retryDelay;
      if (typeof retryDelay === "string") {
        const seconds = Number.parseFloat(retryDelay);
        if (Number.isFinite(seconds)) retryDelayMs = seconds * 1000;
      }
    } catch {}
    const retryAfterHeader = Number(response.headers.get("retry-after"));
    const headerDelayMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader * 1000 : 0;
    const delay = Math.min(60000, Math.max(retryDelayMs, headerDelayMs, retryBaseDelayMs * (2 ** attempt)));
    console.warn("Gemini agent", role, "HTTP", status, "; retry", attempt + 1, "after", delay, "ms:", detail.slice(0, 160));
    if (delay > 0) await wait(delay);
  }
  const payload = await response.json();
  const responseText = payload.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("") || "";
  const parsed = parseJson(responseText);
  if (!["BUY", "SELL", "HOLD"].includes(parsed.direction) ||
      !Number.isFinite(parsed.confidence) || parsed.confidence < 0 || parsed.confidence > 100 ||
      !Array.isArray(parsed.evidence) || typeof parsed.veto !== "boolean") {
    throw new Error("Invalid Gemini agent response schema");
  }
  console.log("Gemini agent", role, "completed in", ((Date.now() - startedAt) / 1000).toFixed(1), "s:", parsed.direction, parsed.confidence + "%");
  return { role, ...parsed, provider: "Google Gemini", model: MODEL };
}
export async function runIndependentLlmAgents(context, options = {}) {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return { enabled: false, status: "NOT_CONFIGURED", agents: [], decision: "HOLD", reason: "Set GEMINI_API_KEY in GitHub Actions secrets to enable Gemini agents." };
  const requestIntervalMs = Number.isFinite(options.requestIntervalMs) ? options.requestIntervalMs : REQUEST_INTERVAL_MS;
  const retryCount = Number.isInteger(options.retryCount) ? Math.max(0, options.retryCount) : Number(process.env.GEMINI_RETRY_COUNT || 1);
  const retryBaseDelayMs = Number.isFinite(options.retryBaseDelayMs) ? Math.max(0, options.retryBaseDelayMs) : Number(process.env.GEMINI_RETRY_BASE_DELAY_MS || 10000);
  const results = [];
  for (let index = 0; index < ROLES.length; index += 1) {
    try {
      results.push({ status: "fulfilled", value: await runOne(ROLES[index][0], ROLES[index][1], context, apiKey, requestIntervalMs, retryCount, retryBaseDelayMs) });
    } catch (reason) {
      results.push({ status: "rejected", reason });
    }
  }
  const agents = results.map((result, index) => result.status === "fulfilled"
    ? result.value
    : { role: ROLES[index][0], direction: "HOLD", confidence: 0, evidence: [], veto: true, error: result.reason?.message || "Agent failed" });
  const valid = agents.filter(agent => !agent.error);
  const buy = valid.filter(agent => agent.direction === "BUY").length;
  const sell = valid.filter(agent => agent.direction === "SELL").length;
  const veto = agents.some(agent => agent.veto || agent.error);
  const decision = !veto && valid.length === 6 && buy >= 4 ? "BUY"
    : !veto && valid.length === 6 && sell >= 4 ? "SELL" : "HOLD";
  console.log("Gemini swarm finished:", valid.length + "/6 agents valid; votes BUY/SELL/HOLD", buy + "/" + sell + "/" + (valid.length - buy - sell), "decision", decision);
  return { enabled: true, status: valid.length === 6 ? "COMPLETE" : "PARTIAL", provider: "Google Gemini", model: MODEL, agents, votes: { buy, sell, hold: valid.length - buy - sell }, decision, reason: veto ? "At least one agent failed or raised a risk veto." : "Six-agent consensus required; otherwise HOLD." };
}
