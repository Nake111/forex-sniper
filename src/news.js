
const GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const GOOGLE_NEWS_URL = "https://news.google.com/rss/search";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ARTICLES = 15;
const MIN_RELEVANCE_SCORE = 2;
const TIMEOUT_MS = 15000;

const EVENT_RULES = [
  {
    name: "CENTRAL BANK",
    words: [
      "ecb",
      "federal reserve",
      "fed",
      "central bank",
      "monetary policy"
    ]
  },
  {
    name: "INFLATION",
    words: [
      "inflation",
      "cpi",
      "pce",
      "consumer prices",
      "producer prices"
    ]
  },
  {
    name: "EMPLOYMENT",
    words: [
      "nfp",
      "nonfarm payroll",
      "payrolls",
      "unemployment",
      "jobless claims",
      "employment data",
      "jobs report"
    ]
  },
  {
    name: "INTEREST RATES",
    words: [
      "interest rate",
      "rate decision",
      "rate cut",
      "rate hike",
      "rate hold",
      "bond yield",
      "treasury yields"
    ]
  },
  {
    name: "ECONOMIC GROWTH",
    words: [
      "gdp",
      "pmi",
      "retail sales",
      "economic growth",
      "recession"
    ]
  },
  {
    name: "GEOPOLITICS",
    words: [
      "tariff",
      "trade war",
      "sanctions",
      "geopolitical",
      "war",
      "oil prices"
    ]
  }
];

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

function classifyArticle(article) {
  const title = String(article.title || "").toLowerCase();

  let score = 0;
  const matchedEvents = [];

  const directPair =
    /\beur\/usd\b|\beurusd\b|euro.*dollar|dollar.*euro/.test(title);

  const hasECB =
    /\becb\b|european central bank/.test(title);

  const hasFed =
    /\bfed\b|federal reserve/.test(title);

  // Direct EUR/USD coverage receives the strongest relevance bonus.
  if (directPair) {
    score += 3;
  }

  // Central bank references are relevant but not automatically high impact.
  if (hasECB || hasFed) {
    score += 2;
  }

  if (
    /\beuro\b|\beuros\b|\bus dollar\b|\bu\.s\. dollar\b|\bdollar index\b/.test(title)
  ) {
    score += 1;
  }

  // Detect economic event categories.
  for (const event of EVENT_RULES) {
    if (event.words.some(word => title.includes(word))) {
      score += 1;
      matchedEvents.push(event.name);
    }
  }

  // Specific major economic announcements.
  const highImpactEvent =
    /\brate decision\b|raises interest rates|cuts interest rates|inflation (?:rises|falls|jumps|drops) to|cpi report|consumer price index|nonfarm payroll|\bnfp\b|jobs report|unemployment rate (?:rises|falls|jumps|drops)|gdp (?:growth|falls|rises|report)|flash pmi|currency intervention|emergency central bank meeting/.test(title);

  if (highImpactEvent) {
    score += 2;
  }

  let relevance = "LOW";

  // HIGH requires a specific event AND sufficient EUR/USD relevance.
  if (highImpactEvent && score >= 5) {
    relevance = "HIGH";
  } else if (score >= 2) {
    relevance = "MEDIUM";
  }

  return {
    ...article,
    score,
    relevance,
    eventType: matchedEvents.length
      ? matchedEvents.join(", ")
      : "GENERAL FX"
  };
}

function isSafeArticleUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeArticles(articles) {
  if (!Array.isArray(articles)) {
    throw new Error("News provider returned an invalid article list");
  }

  const unique = new Map();

  for (const article of articles) {
    if (!article || typeof article !== "object" ||
      typeof article.title !== "string" ||
      !article.title.trim() ||
      !isSafeArticleUrl(article.url) ||
      !isRecent(article)
    ) {
      continue;
    }

    const classified = classifyArticle(article);

    if (classified.score < MIN_RELEVANCE_SCORE) {
      continue;
    }

    const key = article.title
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 100);

    if (!unique.has(key)) {
      unique.set(key, classified);
    }
  }

  return [...unique.values()]
    .sort((a, b) =>
      b.score - a.score ||
      parseDate(b.date) - parseDate(a.date)
    )
    .slice(0, MAX_ARTICLES);
}

function parseRss(xml) {
  const items = [
    ...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)
  ];

  return items.map(([, item]) => {
    function getTag(tag) {
      const escaped = tag.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

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
  });
}

async function getGoogleNews() {
  const params = new URLSearchParams({
    q: '(EUR/USD OR EURUSD OR euro OR dollar OR ECB OR "Federal Reserve" OR "European Central Bank") when:1d',
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

  return normalizeArticles(parseRss(xml));
}

async function getGdeltNews() {
  const params = new URLSearchParams({
    query: '("EUR/USD" OR EURUSD OR euro OR dollar OR "European Central Bank" OR "Federal Reserve")',
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
    throw new Error(
      `GDELT HTTP ${response.status}`
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("GDELT returned invalid JSON");
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.articles)) {
    throw new Error("GDELT response is missing the articles array");
  }

  const articles = data.articles.map(article => ({
    title: article.title,
    source: article.domain || "GDELT",
    date: article.seendate,
    url: article.url
  }));

  return normalizeArticles(articles);
}

function printNewsReport(articles, source) {
  console.log("");
  console.log("EUR/USD NEWS INTELLIGENCE");
  console.log("-------------------------");
  console.log(`SOURCE: ${source}`);
  console.log(`RELEVANT ARTICLES: ${articles.length}`);
  console.log("NEWS IS CONTEXT ONLY — NOT A TRADE SIGNAL.");

  const high = articles.filter(
    article => article.relevance === "HIGH"
  ).length;

  const medium = articles.filter(
    article => article.relevance === "MEDIUM"
  ).length;

  const low = articles.filter(
    article => article.relevance === "LOW"
  ).length;

  console.log(`HIGH IMPACT CANDIDATES: ${high}`);
  console.log(`MEDIUM RELEVANCE: ${medium}`);
  console.log(`LOW RELEVANCE: ${low}`);

  for (const [index, article] of articles.entries()) {
    console.log("");

    console.log(
      `${index + 1}. [${article.relevance}] [${article.eventType}]`
    );

    console.log(`TITLE: ${article.title}`);
    console.log(`SOURCE: ${article.source}`);
    console.log(`DATE: ${article.date}`);
    console.log(`RELEVANCE SCORE: ${article.score}`);
    console.log(`URL: ${article.url}`);
  }
}

export async function getForexNews() {
  console.log("");
  console.log("NEWS INTELLIGENCE STARTED");
  console.log("-------------------------");

  // Google News is primary because GDELT previously returned HTTP 429.
  try {
    const articles = await getGoogleNews();

    if (articles.length > 0) {
      printNewsReport(
        articles,
        "GOOGLE NEWS RSS"
      );

      return articles;
    }

    console.log(
      "Google News: no relevant articles. Trying GDELT."
    );
  } catch (error) {
    console.log(
      `Google News failed: ${error.message}`
    );
  }

  // GDELT backup.
  try {
    const articles = await getGdeltNews();

    if (articles.length > 0) {
      printNewsReport(articles, "GDELT");

      return articles;
    }

    console.log(
      "GDELT: no relevant articles found."
    );
  } catch (error) {
    console.log(
      `GDELT failed: ${error.message}`
    );
  }

  console.log(
    "NEWS STATUS: NO RELEVANT ARTICLES AVAILABLE."
  );

  return [];
}
