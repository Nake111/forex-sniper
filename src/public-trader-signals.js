/**
 * Optional public-market idea corroboration from administrator-configured RSS feeds.
 * Feed metadata is checked; this does not verify trader identity or performance.
 * This module is advisory only and never changes signal approval.
 */
const SYMBOL_PATTERNS = {
  EURUSD: [/\bEUR\s*[/_-]?\s*USD\b/i, /\bEURUSD\b/i],
  BTCUSD: [/\bBTC\s*[/_-]?\s*USD\b/i, /\bBTCUSD\b/i, /\bBITCOIN\b/i],
  XAUUSD: [/\bXAU\s*[/_-]?\s*USD\b/i, /\bXAUUSD\b/i, /\bGOLD\b/i]
};
const BUY_WORDS = /\b(buy|long|bullish|upside|breakout higher)\b/i;
const SELL_WORDS = /\b(sell|short|bearish|downside|breakdown lower)\b/i;

function decodeXml(value = "") {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}
function tagValue(xml, names) {
  const tags = [...xml.matchAll(/<([\w:]+)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)];
  const match = tags.find(entry => names.includes(entry[1].split(":").at(-1).toLowerCase()));
  return match ? decodeXml(match[2]) : "";
}
function classifyItem(item, market, sourceUrl, now, maxAgeMs) {
  const title = tagValue(item, ["title"]);
  const description = tagValue(item, ["description", "summary", "content"]);
  const published = tagValue(item, ["pubDate", "published", "updated", "date"]);
  const linkText = tagValue(item, ["link"]);
  const linkAttr = item.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1];
  const link = linkAttr || linkText;
  const text = (title + " " + description).slice(0, 5000);
  if (!SYMBOL_PATTERNS[market]?.some(pattern => pattern.test(text))) return null;
  const buy = BUY_WORDS.test(text), sell = SELL_WORDS.test(text);
  if (buy === sell) return null;
  const timestamp = Date.parse(published);
  if (!Number.isFinite(timestamp) || timestamp > now + 60_000 || now - timestamp > maxAgeMs) return null;
  let feed, article;
  try {
    feed = new URL(sourceUrl); article = new URL(link, feed);
    if (feed.protocol !== "https:" || article.protocol !== "https:" || article.hostname !== feed.hostname) return null;
  } catch { return null; }
  return {
    market, direction: buy ? "BUY" : "SELL", timestamp: new Date(timestamp).toISOString(),
    source: feed.hostname, url: article.toString(), title: title.slice(0, 240),
    evidenceType: "PUBLIC_RSS_IDEA_MENTION", sourceVerified: true, traderIdentityVerified: false
  };
}
export function parsePublicIdeaFeed(xml, { market, sourceUrl, now = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
  if (!SYMBOL_PATTERNS[market] || typeof xml !== "string") return [];
  const items = [...xml.matchAll(/<(item|entry)\b[^>]*>[\s\S]*?<\/\1>/gi)].map(match => match[0]);
  return items.map(item => classifyItem(item, market, sourceUrl, now, maxAgeMs)).filter(Boolean);
}
export function summarizePublicTraderEvidence(ideas = []) {
  const unique = [...new Map(ideas.map(idea => [idea.url, idea])).values()];
  const buy = unique.filter(idea => idea.direction === "BUY").length;
  const sell = unique.filter(idea => idea.direction === "SELL").length;
  return {
    status: unique.length ? "ADVISORY_PUBLIC_IDEAS_FOUND" : "NO_VERIFIED_PUBLIC_IDEAS",
    total: unique.length, buy, sell,
    consensus: buy > sell ? "BUY" : sell > buy ? "SELL" : "MIXED_OR_NONE",
    ideas: unique, mayOverrideValidation: false,
    identityWarning: "Feed publication and source domain are checked; individual trader identity and performance are not verified."
  };
}
export async function fetchPublicTraderEvidence(market, {
  feedUrls = (process.env.PUBLIC_TRADER_RSS_URLS ?? "").split(",").map(value => value.trim()).filter(Boolean),
  fetchImpl = fetch, timeoutMs = 5_000, now = Date.now(),
  maxAgeMs = 24 * 60 * 60 * 1000, maxFeeds = 3
} = {}) {
  if (!SYMBOL_PATTERNS[market]) return { status: "UNSUPPORTED_MARKET", total: 0, ideas: [], mayOverrideValidation: false };
  const urls = feedUrls.slice(0, maxFeeds);
  if (!urls.length) return {
    status: "NOT_CONFIGURED", total: 0, buy: 0, sell: 0, consensus: "MIXED_OR_NONE",
    ideas: [], mayOverrideValidation: false,
    note: "Set PUBLIC_TRADER_RSS_URLS to up to three HTTPS RSS/Atom feeds from public market-idea publishers."
  };
  const batches = await Promise.all(urls.map(async url => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") return [];
      const response = await fetchImpl(parsed.toString(), {
        headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) return [];
      return parsePublicIdeaFeed(await response.text(), { market, sourceUrl: parsed.toString(), now, maxAgeMs });
    } catch { return []; }
  }));
  return summarizePublicTraderEvidence(batches.flat());
}
