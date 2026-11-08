// Six specialist Gemini perspectives in ONE request for low-latency confirmation.
// These are six role-separated assessments from one model response, not six isolated API calls.
// Target latency is 2 seconds; cloud-provider/network latency is outside our control.
// A single request avoids serial pacing/rate-limit delays. Cloud review is advisory;\n// local deterministic agents remain the primary signal path when the API is slow.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const API_BASE = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 8000);
const ROLES = [
  ["technical", "Assess trend, momentum, volatility and timeframe alignment."],
  ["market_structure", "Assess swing structure, BOS/CHOCH, liquidity sweeps and support/resistance."],
  ["quant", "Assess supplied returns, volatility, probability and uncertainty; do not invent statistics."],
  ["macro", "Assess only supplied news and macro fields; do not invent events or headlines."],
  ["risk", "Act as risk officer: identify stale data, event risk, poor reward/risk and reasons to veto."],
  ["contrarian", "Challenge the proposed direction; identify counter-evidence and missing confirmation."]
];
const VALID_DIRECTIONS = new Set(["BUY", "SELL", "HOLD"]);

function extractJson(text) {
  const source = String(text || "").trim();
  try { return JSON.parse(source); } catch {}
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Gemini did not return JSON");
  return JSON.parse(source.slice(start, end + 1));
}

function validateAgents(payload) {
  if (!payload || !Array.isArray(payload.agents)) throw new Error("Missing agents array");
  const byRole = new Map(payload.agents.map(agent => [agent?.role, agent]));
  if (byRole.size !== 6 || ROLES.some(([role]) => !byRole.has(role))) {
    throw new Error("Gemini must return exactly six unique agent roles");
  }
  return ROLES.map(([role]) => {
    const agent = byRole.get(role);
    if (!VALID_DIRECTIONS.has(agent.direction) ||
        !Number.isFinite(agent.confidence) || agent.confidence < 0 || agent.confidence > 100 ||
        !Array.isArray(agent.evidence) || typeof agent.veto !== "boolean") {
      throw new Error("Invalid response schema for " + role);
    }
    return {
      role,
      direction: agent.direction,
      confidence: agent.confidence,
      evidence: agent.evidence.slice(0, 3).map(item => String(item).slice(0, 180)),
      veto: agent.veto,
      provider: "Google Gemini",
      model: MODEL
    };
  });
}

export async function runIndependentLlmAgents(context, options = {}) {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { enabled: false, status: "NOT_CONFIGURED", agents: [], decision: "HOLD",
      reason: "Set GEMINI_API_KEY in GitHub Actions secrets to enable Gemini confirmation." };
  }

  const startedAt = Date.now();
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : TIMEOUT_MS;
  const endpoint = API_BASE.replace(/\/$/, "") + "/models/" + encodeURIComponent(MODEL) + ":generateContent";
  const roleInstructions = ROLES.map(([role, instruction]) => role + ": " + instruction).join("\n");
  const prompt = [
    "You are a panel of six specialist trading agents. Produce six separate assessments, one for each exact role below.",
    roleInstructions,
    "Use only the supplied market data. Do not invent prices, news, indicators or facts.",
    "Each assessment must independently choose BUY, SELL or HOLD, give confidence 0-100, 1-3 short evidence items, and veto true/false.",
    "Return ONLY JSON matching this schema: " + JSON.stringify({ agents: [{ role: "technical", direction: "BUY|SELL|HOLD", confidence: 0, evidence: ["..."], veto: false }] }),
    "Include all six roles exactly once. Be concise."
  ].join("\n\n");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt + "\n\nMARKET CONTEXT:\n" + JSON.stringify(context) }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1600, responseMimeType: "application/json" }
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error("Gemini HTTP " + response.status + (detail ? ": " + detail.slice(0, 240) : ""));
    }
    const payload = await response.json();
    const text = payload.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("") || "";
    const agents = validateAgents(extractJson(text));
    const buy = agents.filter(agent => agent.direction === "BUY").length;
    const sell = agents.filter(agent => agent.direction === "SELL").length;
    const veto = agents.some(agent => agent.veto);
    const decision = !veto && buy >= 4 ? "BUY" : !veto && sell >= 4 ? "SELL" : "HOLD";
    const elapsedMs = Date.now() - startedAt;
    console.log("Gemini six-agent panel:", "6/6 valid in", elapsedMs, "ms; BUY/SELL/HOLD", buy + "/" + sell + "/" + (6 - buy - sell), "decision", decision);
    if (elapsedMs > 2000) console.warn("Gemini confirmation exceeded the 2-second target:", elapsedMs, "ms");
    return {
      enabled: true, status: "COMPLETE", provider: "Google Gemini", model: MODEL,
      mode: "single-request-six-role-panel", elapsedMs, targetMs: 2000,
      agents, votes: { buy, sell, hold: 6 - buy - sell }, decision,
      reason: veto ? "At least one specialist raised a risk veto." : "Six-role consensus required; otherwise HOLD."
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    console.warn("Gemini six-agent panel failed closed after", elapsedMs, "ms:", error.message);
    return {
      enabled: true, status: timedOut ? "TIMEOUT" : "ERROR", provider: "Google Gemini", model: MODEL,
      mode: "single-request-six-role-panel", elapsedMs, targetMs: 2000,
      agents: ROLES.map(([role]) => ({ role, direction: "HOLD", confidence: 0, evidence: [], veto: true, error: error.message })),
      votes: { buy: 0, sell: 0, hold: 6 }, decision: "HOLD",
      reason: timedOut ? "Gemini did not respond before the 2-second deadline; safe HOLD." : "Gemini confirmation failed; safe HOLD."
    };
  }
}
