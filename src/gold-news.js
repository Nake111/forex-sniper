const RSS = "https://news.google.com/rss/search";
const GDELT = "https://api.gdeltproject.org/api/v2/doc/doc";
const TIMEOUT = 12000;
const TERMS = /\b(gold|bullion|xauusd|precious metal|federal reserve|fed|fomc|treasury yield|real yield|dollar index|dxy|us dollar|cpi|inflation|pce|nonfarm payroll|nfp|central bank|geopolitical|safe haven|tariff|sanction)\b/i;
const HIGH = /\b(fomc|rate decision|interest rate|cpi|inflation|pce|nonfarm payroll|\bnfp\b|treasury yield|real yield|fed chair|central bank)\b/i;

function decode(value) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const get = tag => {
      const match = item.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", "i"));
      return match ? decode(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").trim()) : "";
    };
    return { title: get("title"), source: get("source") || "Google News", date: get("pubDate"), url: get("link") };
  });
}
function parseDate(value) {
  const parsed = Date.parse(value ?? "");
  if (Number.isFinite(parsed)) return parsed;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(String(value ?? ""));
  return match ? Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]) : NaN;
}
function normalize(items) {
  const seen = new Set();
  return items.filter(article => {
    const published = parseDate(article.date);
    const age = Date.now() - published;
    if (!article.title || !article.url || !Number.isFinite(published) || !Number.isFinite(age) || age < 0 || age > 86400000 || !TERMS.test(article.title)) return false;
    const key = article.title.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20).map(article => ({ ...article, relevance: HIGH.test(article.title) ? "HIGH" : "MEDIUM", score: HIGH.test(article.title) ? 3 : 1 }));
}
export async function getGoldNews() {
  const query = '(gold OR bullion OR XAUUSD OR "Federal Reserve" OR FOMC OR "US Treasury yields" OR DXY OR CPI OR inflation OR NFP) when:1d';
  const url = RSS + "?" + new URLSearchParams({ q: query, hl: "en-US", gl: "US", ceid: "US:en" });
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!response.ok) throw new Error("Google News HTTP " + response.status);
    const articles = normalize(parseRss(await response.text()));
    if (!articles.length) throw new Error("Google News returned no recent relevant headlines; trying GDELT fallback");
    console.log("XAUUSD NEWS INTELLIGENCE — Google News RSS —", articles.length, "articles");
    for (const article of articles) console.log("[" + article.relevance + "]", article.title, "|", article.source, "|", article.date, "|", article.url);
    return articles;
  } catch (error) {
    console.error("Gold Google News unavailable:", error.message);
    try {
      const params = new URLSearchParams({ query: '(gold OR bullion OR XAUUSD OR "Federal Reserve" OR FOMC OR "US Treasury yields" OR DXY OR CPI OR inflation OR NFP)', mode: "artlist", format: "json", timespan: "24h", maxrecords: "30", sort: "datedesc" });
      const response = await fetch(GDELT + "?" + params, { signal: AbortSignal.timeout(TIMEOUT) });
      if (!response.ok) throw new Error("GDELT HTTP " + response.status);
      const data = await response.json();
      return normalize((data.articles || []).map(article => ({ title: article.title, source: article.domain || "GDELT", date: article.seendate, url: article.url })));
    } catch (fallbackError) {
      console.error("Gold GDELT unavailable:", fallbackError.message);
      return [];
    }
  }
}
