
const GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const GOOGLE_NEWS_URL = "https://news.google.com/rss/search";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ARTICLES = 15;
const TIMEOUT_MS = 15000;

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseDate(value) {
  const parsed = Date.parse(value);

  if (Number.isFinite(parsed)) {
    return parsed;
  }

  const match = String(value).match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/
  );

  if (!match) return NaN;

  const [, y, m, d, h, min, s] = match;

  return Date.UTC(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(h),
    Number(min),
    Number(s)
  );
}

function isRecent(article) {
  const published = parseDate(article.date);
  const age = Date.now() - published;

  return (
    Number.isFinite(published) &&
    age >= 0 &&
    age <= DAY_MS
  );
}

function parseRss(xml) {
  const items = [...xml.matchAll(
    /<item>([\s\S]*?)<\/item>/g
  )];

  return items
    .map(([, item]) => {
      function getTag(tag) {
        const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        const match = item.match(
          new RegExp(
            `<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`,
            "i"
          )
        );

        return match
          ? decodeXml(match[1].trim())
          : "";
      }

      return {
        title: getTag("title"),
        source: getTag("source") || "Google News",
        date: getTag("pubDate"),
        url: getTag("link")
      };
    })
    .filter(article =>
      article.title &&
      article.url &&
      isRecent(article)
    )
    .slice(0, MAX_ARTICLES);
}

async function getGdeltNews() {
  const params = new URLSearchParams({
    query:
      '("EUR/USD" OR EURUSD OR "euro dollar" OR "European Central Bank" OR "Federal Reserve")',
    mode: "artlist",
    format: "json",
    timespan: "24h",
    maxrecords: String(MAX_ARTICLES),
    sort: "datedesc"
  });

  const response = await fetch(
    `${GDELT_URL}?${params}`,
    {
      signal: AbortSignal.timeout(TIMEOUT_MS)
    }
  );

  if (!response.ok) {
    throw new Error(`GDELT HTTP ${response.status}`);
  }

  const data = await response.json();

  const articles = (data.articles || [])
    .map(article => ({
      title: article.title,
      source: article.domain || "GDELT",
      date: article.seendate,
      url: article.url
    }))
    .filter(article =>
      article.title &&
      article.url &&
      isRecent(article)
    )
    .slice(0, MAX_ARTICLES);

  console.log(
    `GDELT: ${articles.length} recent articles found.`
  );

  return articles;
}

async function getGoogleNews() {
  const params = new URLSearchParams({
    q:
      '(EUR/USD OR EURUSD OR "European Central Bank" OR "Federal Reserve") when:1d',
    hl: "en-US",
    gl: "US",
    ceid: "US:en"
  });

  const response = await fetch(
    `${GOOGLE_NEWS_URL}?${params}`,
    {
      signal: AbortSignal.timeout(TIMEOUT_MS)
    }
  );

  if (!response.ok) {
    throw new Error(
      `Google News HTTP ${response.status}`
    );
  }

  const xml = await response.text();
  const articles = parseRss(xml);

  console.log(
    `Google News RSS: ${articles.length} recent articles found.`
  );

  return articles;
}

export async function getForexNews() {
  console.log("");
  console.log("NEWS ENGINE STARTED");
  console.log("-------------------");

  let gdeltError = null;

  // Try GDELT first.
  try {
    const articles = await getGdeltNews();

    if (articles.length > 0) {
      console.log("NEWS SOURCE: GDELT");
      return articles;
    }

    console.log(
      "GDELT returned no recent articles. Trying backup."
    );
  } catch (error) {
    gdeltError = error;

    console.log(
      `GDELT FAILED: ${error.message}`
    );

    console.log(
      "Trying Google News RSS backup."
    );
  }

  // Try Google News if GDELT is empty or unavailable.
  try {
    const articles = await getGoogleNews();

    if (articles.length > 0) {
      console.log("NEWS SOURCE: GOOGLE NEWS RSS");
      return articles;
    }

    console.log(
      "Google News returned no recent articles."
    );
  } catch (error) {
    console.log(
      `GOOGLE NEWS FAILED: ${error.message}`
    );
  }

  if (gdeltError) {
    console.log(
      `GDELT ERROR DETAILS: ${gdeltError.message}`
    );
  }

  console.log(
    "NEWS STATUS: NO RECENT ARTICLES AVAILABLE."
  );

  return [];
}
