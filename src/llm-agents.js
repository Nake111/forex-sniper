// Six specialist Gemini perspectives in ONE request for low-latency confirmation.
// These are six role-separated assessments from one model response, not six isolated API calls.
// Target latency is 2 seconds; cloud-provider/network latency is outside our control.
// A single request avoids serial pacing/rate-limit delays. Cloud review is advisory;\n// local deterministic agents remain the primary signal path when the API is slow.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const API_BASE = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";
// Keep optional cloud review off the critical path; local deterministic agents decide on timeout.
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 2000);
const ROLES = [
  ["technical", "Assess trend, momentum, volatility and timeframe alignment."],
  ["market_structure", "Assess swing structure, BOS/CHOCH, liquidity sweeps and support/resistance."],
  ["quant", "Assess supplied returns, volatility, probability and uncertainty; do not invent statistics."],
  ["macro", "Assess only supplied news and macro fields; do not invent events or headlines."],
  ["risk", "Act as risk officer: identify stale data, event risk, poor reward/risk and reasons to veto."],
  ["contrarian", "Challenge the proposed direction; identify counter-evidence and missing confirmation."]
];
const VALID_DIRECTIONS = new Set(["BUY", "SELL", "HOLD"]);

function compactFrame(frame) {
  if (!frame) return null;
  const fields = [
    "close", "regime", "ema20", "ema50", "rsi14", "macd", "macdSignal",
    "macdHistogram", "atr14", "adx14", "bullishVotes", "bearishVotes",
    "vwap", "poc", "valueAreaHigh", "valueAreaLow"
  ];
  const result = Object.fromEntries(fields.filter(key => frame[key] !== undefined).map(key => [key, frame[key]]));
  result.supertrend = frame.supertrend?.direction ?? null;
  result.ichimoku = frame.ichimoku?.direction ?? null;
  result.squeeze = frame.squeeze ? { state: frame.squeeze.state, direction: frame.squeeze.direction, momentum: frame.squeeze.momentum } : null;
  result.cvd = frame.cvd ? { direction: frame.cvd.direction, slope: frame.cvd.slope } : null;
  result.structure = frame.structure ? {
    bos: frame.structure.bos, sweep: frame.structure.sweep,
    sweepConfirmed: frame.structure.sweepConfirmed, liquiditySweep: frame.structure.liquiditySweep
  } : null;
  result.orderBlocks = (frame.smartMoney?.orderBlocks ?? []).slice(0, 2).map(zone => ({
    direction: zone.direction, high: zone.high, low: zone.low, barsAgo: zone.barsAgo, invalidated: zone.invalidated
  }));
  result.fairValueGaps = (frame.smartMoney?.fairValueGaps ?? []).slice(0, 2).map(zone => ({
    direction: zone.direction, top: zone.top, bottom: zone.bottom, barsAgo: zone.barsAgo, filled: zone.filled
  }));
  return result;
}

function compactContext(context = {}) {
  const macro = context.macro ?? {};
  const panel = context.deterministicAgents ?? {};
  return {
    market: context.market,
    timeframes: Object.fromEntries(["M5", "M15", "H1", "H4"].map(key => [key, compactFrame(context.frames?.[key])])),
    macro: {
      eventRisk: macro.eventRisk ?? "UNKNOWN",
      dataStale: macro.dataStale === true,
      staleTimeframes: macro.staleTimeframes ?? [],
      goldMacroBias: macro.goldMacroBias ?? null,
      eventCount: Array.isArray(macro.calendar?.events) ? macro.calendar.events.length : null,
      headlines: (macro.headlines ?? []).slice(0, 4).map(item =>
        typeof item === "string" ? item.slice(0, 180) : {
          title: String(item.title ?? item.headline ?? "").slice(0, 180),
          publishedAt: item.publishedAt ?? item.published_at ?? null
        })
    },
    deterministicPanel: {
      agents: (panel.agents ?? []).map(agent => ({
        name: agent.name, direction: agent.direction, weight: agent.weight,
        evidence: String(agent.evidence ?? "").slice(0, 160)
      })),
      trader: panel.trader,
      riskManager: panel.riskManager,
      portfolioManager: panel.portfolioManager
    },
    polymarket: context.polymarket ? {
      status: context.polymarket.status, bias: context.polymarket.bias,
      summary: String(context.polymarket.summary ?? "").slice(0, 300)
    } : null
  };
}

function stripTrailingCommas(source) {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === ",") {
      let next = i + 1;
      while (next < source.length && /\s/.test(source[next])) next++;
      if (source[next] === "}" || source[next] === "]") continue;
    }
    output += char;
  }
  return output;
}

export function extractJson(text) {
  let source = String(text || "").trim();
  source = source.replace(/^\s*`{3}(?:json)?\s*/i, "").replace(/\s*`{3}\s*$/, "").trim();
  const start = source.indexOf("{");
  if (start < 0) throw new Error("Gemini did not return a JSON object");
  // Find the matching outer brace without being confused by braces in strings.
  let depth = 0, inString = false, escaped = false, end = -1;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) { end = i; break; }
  }
  if (end < 0) throw new Error("Gemini returned incomplete JSON (unclosed object)");
  const candidate = stripTrailingCommas(source.slice(start, end + 1));
  try { return JSON.parse(candidate); }
  catch (error) { throw new Error("Gemini JSON parse failed: " + error.message); }
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
  const responseSchema = {
    type: "OBJECT",
    properties: {
      agents: {
        type: "ARRAY",
        minItems: 6,
        maxItems: 6,
        items: {
          type: "OBJECT",
          properties: {
            role: { type: "STRING", enum: ROLES.map(([role]) => role) },
            direction: { type: "STRING", enum: ["BUY", "SELL", "HOLD"] },
            confidence: { type: "NUMBER" },
            evidence: { type: "ARRAY", items: { type: "STRING" } },
            veto: { type: "BOOLEAN" }
          },
          required: ["role", "direction", "confidence", "evidence", "veto"]
        }
      }
    },
    required: ["agents"]
  };
  const prompt = [
    "Act as six independent trading specialists in one panel. Return exactly six role assessments.",
    roleInstructions,
    "Use only supplied market data. Never invent prices, indicators, news or events.",
    "Each role must choose BUY, SELL or HOLD; confidence must be 0-100; give at most two short evidence strings; veto must be true or false.",
    "Return one JSON object only. No markdown, comments, trailing commas, or extra keys.",
    "All six exact role names must appear once, with no missing or duplicate roles."
  ].join("\n\n");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt + "\n\nCOMPACT MARKET CONTEXT (data only):\n" + JSON.stringify(compactContext(context)) }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 1800,
          responseMimeType: "application/json",
          responseSchema
        }
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
    // Local risk controls are authoritative. Gemini cannot waive a known
    // high-impact event block, even if its generated roles disagree.
    const macroRisk = context.macro?.eventRisk ?? "UNKNOWN";
    const hardRiskBlock = macroRisk === "HIGH" || context.macro?.dataStale === true ||
      (context.market === "XAUUSD" && macroRisk !== "NORMAL");
    const decision = hardRiskBlock || veto ? "HOLD"
      : buy >= 4 ? "BUY" : sell >= 4 ? "SELL" : "HOLD";
    const elapsedMs = Date.now() - startedAt;
    console.log(context.market + " Gemini six-agent panel:", "6/6 valid in", elapsedMs, "ms; BUY/SELL/HOLD", buy + "/" + sell + "/" + (6 - buy - sell), "decision", decision,
      hardRiskBlock ? "| LOCAL MACRO RISK VETO" : veto ? "| SPECIALIST VETO" : "");
    if (elapsedMs > TIMEOUT_MS) console.warn("Gemini confirmation exceeded its configured timeout:", elapsedMs, "ms");
    return {
      enabled: true, status: "COMPLETE", provider: "Google Gemini", model: MODEL,
      mode: "single-request-six-role-panel", elapsedMs, targetMs: TIMEOUT_MS,
      agents, votes: { buy, sell, hold: 6 - buy - sell }, decision,
      reason: veto ? "At least one specialist raised a risk veto." : "Six-role consensus required; otherwise HOLD."
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    console.warn("Gemini six-agent panel failed closed after", elapsedMs, "ms:", error.message);
    return {
      enabled: true, status: timedOut ? "TIMEOUT" : "ERROR", provider: "Google Gemini", model: MODEL,
      mode: "single-request-six-role-panel", elapsedMs, targetMs: TIMEOUT_MS,
      agents: [],
      votes: null, decision: null,
      reason: timedOut ? "Gemini did not respond before the configured deadline; retain the local decision." : "Gemini confirmation failed; retain the local decision."
    };
  }
}
