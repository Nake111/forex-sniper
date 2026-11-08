// Optional independent Grok/xAI research agents. No API key is required for the base bot.
const API_URL = process.env.LLM_API_URL || "https://api.x.ai/v1/chat/completions";
const MODEL = process.env.LLM_MODEL || "grok-3-mini";
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 12000);
const ROLES = [
  ["technical", "You are an independent technical analyst. Assess trend, momentum, volatility and timeframe alignment."],
  ["market_structure", "You are an independent market-structure analyst. Assess swings, breakouts, liquidity sweeps and support/resistance."],
  ["quant", "You are an independent quantitative analyst. Assess return distribution, volatility, Bayesian probability and uncertainty."],
  ["macro", "You are an independent macro analyst. Assess only supplied news and macro fields; never invent events."],
  ["risk", "You are an independent risk officer. Look for reasons not to trade, data staleness, event risk and poor reward/risk."],
  ["contrarian", "You are an independent adversarial reviewer. Challenge the proposed direction and identify missing evidence."]
];
function parseJson(text) {
  const cleaned = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Agent did not return JSON");
  return JSON.parse(cleaned.slice(start, end + 1));
}
async function runOne(role, system, context, apiKey) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL, temperature: 0.1, max_tokens: 350,
      messages: [
        { role: "system", content: system + " Return JSON only: {direction: BUY|SELL|HOLD, confidence: integer 0..100, evidence: string[], veto: boolean}. Do not give guarantees or invent data." },
        { role: "user", content: JSON.stringify(context) }
      ]
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`LLM HTTP ${response.status}`);
  const payload = await response.json();
  const parsed = parseJson(payload.choices?.[0]?.message?.content);
  if (!["BUY", "SELL", "HOLD"].includes(parsed.direction) ||
      !Number.isFinite(parsed.confidence) || parsed.confidence < 0 || parsed.confidence > 100 ||
      !Array.isArray(parsed.evidence)) throw new Error("Invalid agent response schema");
  return { role, ...parsed, model: MODEL };
}
export async function runIndependentLlmAgents(context, options = {}) {
  const apiKey = options.apiKey ?? process.env.GROK_API_KEY ?? process.env.LLM_API_KEY;
  if (!apiKey) return { enabled: false, status: "NOT_CONFIGURED", agents: [], decision: "HOLD", reason: "Set GROK_API_KEY (or LLM_API_KEY) to enable independent LLM agents." };
  const results = await Promise.allSettled(ROLES.map(([role, prompt]) => runOne(role, prompt, context, apiKey)));
  const agents = results.map((result, index) => result.status === "fulfilled"
    ? result.value
    : { role: ROLES[index][0], direction: "HOLD", confidence: 0, evidence: [], veto: true, error: result.reason?.message || "Agent failed" });
  const valid = agents.filter(agent => !agent.error);
  const buy = valid.filter(agent => agent.direction === "BUY").length;
  const sell = valid.filter(agent => agent.direction === "SELL").length;
  const veto = agents.some(agent => agent.veto || agent.error);
  const decision = !veto && valid.length === 6 && buy >= 4 ? "BUY"
    : !veto && valid.length === 6 && sell >= 4 ? "SELL" : "HOLD";
  return { enabled: true, status: valid.length === 6 ? "COMPLETE" : "PARTIAL", model: MODEL, agents, votes: { buy, sell, hold: valid.length - buy - sell }, decision, reason: veto ? "At least one agent failed or raised a risk veto." : "Six-agent consensus required; otherwise HOLD." };
}
