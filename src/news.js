const GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const GOOGLE_NEWS_URL = "https://news.google.com/rss/search";
const DAY_MS = 24 * 60 * 60 * 1000;

function decodeXml(text) {
  return text
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parsePublishedDate(value) {
  const parsed = Date.parse(value);

  if (Number.isFinite(parsed)) {
    return parsed;
  }

  const match = String(value).match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/
  );

  if (!match) return NaN;

  const [, year, month, day, hour, minute, second] = match;

  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
}

function isWithinLast24Hours(article) {
  const published = parsePublishedDate(article.date);
  const now = Date.now();

  return (
    Number.isFinite(published) &&
    published <= now &&
    now - published <= DAY_MS
  );
}

function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
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
    .filter(article =>
      article.title &&
      article.url &&
      isWithinLast24Hours(article)
    )
    .slice(0, 15);
}

async function getGoogleNews() {
  const params = new URLSearchParams({
    q: '(EUR/USD OR EURUSD OR "European Central Bank" OR "Federal Reserve") when:1d',
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

  return (data.articles || [])
    .map(article => ({
      title: article.title,
      source: article.domain,
      date: article.seendate,
      url: article.url
    }))
    .filter(article =>
      article.title &&
      article.url &&
      isWithinLast24Hours(article)
    )
    .slice(0, 15);
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
