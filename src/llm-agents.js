// Six independent Gemini research agents. No paid Grok/xAI dependency.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const API_BASE = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 20000);
const REQUEST_INTERVAL_MS = Number(process.env.GEMINI_REQUEST_INTERVAL_MS || 6500);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
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
async function runOne(role, system, context, apiKey) {
  const endpoint = API_BASE.replace(/\/$/, "") + "/models/" + encodeURIComponent(MODEL) + ":generateContent";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system + ' Return exactly one valid JSON object: {"direction":"BUY|SELL|HOLD","confidence":75,"evidence":["short evidence"],"veto":false}. Do not give guarantees or invent data.' }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(context) }] }],
      generationConfig: { maxOutputTokens: 350, responseMimeType: "application/json" }
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error("Gemini HTTP " + response.status + (detail ? ": " + detail.slice(0, 240) : ""));
  }
  const payload = await response.json();
  const responseText = payload.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("") || "";
  const parsed = parseJson(responseText);
  if (!["BUY", "SELL", "HOLD"].includes(parsed.direction) ||
      !Number.isFinite(parsed.confidence) || parsed.confidence < 0 || parsed.confidence > 100 ||
      !Array.isArray(parsed.evidence) || typeof parsed.veto !== "boolean") {
    throw new Error("Invalid Gemini agent response schema");
  }
  return { role, ...parsed, provider: "Google Gemini", model: MODEL };
}
export async function runIndependentLlmAgents(context, options = {}) {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return { enabled: false, status: "NOT_CONFIGURED", agents: [], decision: "HOLD", reason: "Set GEMINI_API_KEY in GitHub Actions secrets to enable Gemini agents." };
  const requestIntervalMs = Number.isFinite(options.requestIntervalMs) ? options.requestIntervalMs : REQUEST_INTERVAL_MS;
  const results = [];
  for (let index = 0; index < ROLES.length; index += 1) {
    if (index > 0 && requestIntervalMs > 0) await wait(requestIntervalMs);
    try {
      results.push({ status: "fulfilled", value: await runOne(ROLES[index][0], ROLES[index][1], context, apiKey) });
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
  return { enabled: true, status: valid.length === 6 ? "COMPLETE" : "PARTIAL", provider: "Google Gemini", model: MODEL, agents, votes: { buy, sell, hold: valid.length - buy - sell }, decision, reason: veto ? "At least one agent failed or raised a risk veto." : "Six-agent consensus required; otherwise HOLD." };
}
