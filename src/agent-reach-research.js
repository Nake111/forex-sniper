import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_ARTICLES = 2;
const MAX_TEXT_CHARS = 2_000;
const DEFAULT_TIMEOUT_MS = 12_000;

function safeUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function matchesMarket(article, market) {
  const title = String(article?.title ?? "").toLowerCase();
  const hasAny = terms => terms.some(term => title.includes(term));
  const broadMacro = hasAny(["fed", "federal reserve", "ecb", "central bank", "inflation", "cpi", "interest rate", "bond yield", "treasury", "dollar index", "dxy", "geopolitic", "tariff", "sanctions"]);
  if (market === "BTCUSD") return hasAny(["bitcoin", "btc", "crypto", "cryptocurrency", "digital asset", "spot etf", "bitcoin etf", "ethereum"]);
  if (market === "XAUUSD") return hasAny(["gold", "xau", "bullion", "precious metal"]) || broadMacro;
  if (market === "EURUSD") return hasAny(["eur/usd", "eurusd", "euro", "dollar", "ecb", "fed", "federal reserve", "central bank", "inflation", "cpi", "interest rate", "employment", "payroll"]);
  return true;
}
function normalizeItem(item, article) {
  if (!item || typeof item !== "object") return null;
  const text = String(item.text ?? item.content ?? item.markdown ?? "").trim();
  if (!text) return null;
  return {
    title: String(item.title ?? article.title ?? "").slice(0, 240),
    url: safeUrl(item.url) ?? safeUrl(article.url),
    author: String(item.author ?? article.source ?? "Unknown publisher").slice(0, 120),
    publishedAt: item.published_at ?? item.publishedAt ?? article.date ?? null,
    text: text.slice(0, MAX_TEXT_CHARS),
    trust: "UNTRUSTED_EXTERNAL_SOURCE_TEXT"
  };
}

function parseResult(stdout, article) {
  let payload;
  try {
    payload = JSON.parse(String(stdout ?? "").trim());
  } catch {
    throw new Error("Agent-Reach returned non-JSON output");
  }
  if (payload?.ok !== true || !Array.isArray(payload.items)) {
    const code = payload?.error?.code ?? "UNKNOWN";
    const message = payload?.error?.message ?? payload?.error?.hint ?? "No readable article body";
    throw new Error(`Agent-Reach ${code}: ${String(message).slice(0, 240)}`);
  }
  return payload.items.map(item => normalizeItem(item, article)).filter(Boolean);
}

/**
 * Enrich already-discovered market headlines with article body text through
 * Agent-Reach. It is optional, read-only, zero-vote research: it never changes
 * candidate direction, quotes, candle data, risk gates or approval.
 */
export async function enrichNewsWithAgentReach(articles, {
  market = "UNKNOWN",
  enabled = process.env.AGENT_REACH_ENABLED !== "false",
  command = process.env.AGENT_REACH_BIN ?? "agent-reach",
  execFileImpl = execFileAsync,
  maxArticles = MAX_ARTICLES,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const candidates = (Array.isArray(articles) ? articles : [])
    .filter(article => article && typeof article.title === "string" && safeUrl(article.url) && matchesMarket(article, market))
    .slice(0, Math.max(0, Math.min(MAX_ARTICLES, Number(maxArticles) || 0)));

  const base = {
    provider: "Agent-Reach",
    market,
    fetchedAt: new Date().toISOString(),
    researchOnly: true,
    voteWeight: 0,
    canApproveSignal: false,
    items: []
  };
  if (!enabled) return { ...base, status: "DISABLED", reason: "AGENT_REACH_ENABLED=false" };
  if (!candidates.length) return { ...base, status: "NO_MATCHING_HEADLINES", reason: "No safe article URLs available for enrichment" };

  const errors = [];
  const items = [];
  for (const article of candidates) {
    try {
      const { stdout } = await execFileImpl(command, ["read", safeUrl(article.url)], {
        timeout: timeoutMs,
        maxBuffer: 1_500_000,
        windowsHide: true,
        env: process.env
      });
      items.push(...parseResult(stdout, article));
    } catch (error) {
      errors.push(String(error?.message ?? error).slice(0, 300));
    }
  }
  const unique = [...new Map(items.filter(item => item.url).map(item => [item.url, item])).values()];
  return {
    ...base,
    status: unique.length ? (errors.length ? "PARTIAL" : "AVAILABLE") : "UNAVAILABLE",
    items: unique.slice(0, MAX_ARTICLES),
    errors,
    reason: unique.length ? null : (errors[0] ?? "Agent-Reach returned no readable article text")
  };
}
