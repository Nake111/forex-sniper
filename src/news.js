const GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const GOOGLE_NEWS_URL = "https://news.google.com/rss/search";

function decodeXml(text) {
  return text
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .slice(0, 15)
    .map(([_, item]) => {
      const get = (tag) => {
        const match = item.match(
          new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)
        );
        return match ? decodeXml(match[1].trim()) : "";
      };

      return {
        title: get("title"),
        source: get("source") || "Google News",
        date: get("pubDate"),
        url: get("link")
      };
    })
    .filter(article => article.title && article.url);
}

async function getGoogleNews() {
  const params = new URLSearchParams({
    q: 'EUR/USD OR EURUSD OR "European Central Bank" OR "Federal Reserve"',
    hl: "en-US",
    gl: "US",
    ceid: "US:en"
  });

  const response = await fetch(
    `${GOOGLE_NEWS_URL}?${params}`,
    { signal: AbortSignal.timeout(15000) }
  );

  if (!response.ok) {
    throw new Error(`Google News error: ${response.status}`);
  }

  return parseRss(await response.text());
}

async function getGdeltNews() {
  const params = new URLSearchParams({
    query: '("EUR/USD" OR EURUSD OR "euro dollar" OR "European Central Bank" OR "Federal Reserve")',
    mode: "artlist",
    format: "json",
    timespan: "24h",
    maxrecords: "15",
    sort: "datedesc"
  });

  const response = await fetch(
    `${GDELT_URL}?${params}`,
    { signal: AbortSignal.timeout(15000) }
  );

  if (!response.ok) {
    throw new Error(`GDELT error: ${response.status}`);
  }

  const data = await response.json();

  return (data.articles || []).map(article => ({
    title: article.title,
    source: article.domain,
    date: article.seendate,
    url: article.url
  }));
}

export async function getForexNews() {
  try {
    return await getGdeltNews();
  } catch (error) {
    console.log("GDELT unavailable. Trying Google News RSS...");

    try {
      return await getGoogleNews();
    } catch (backupError) {
      console.log("Both news sources unavailable:", backupError.message);
      return [];
    }
  }
}
