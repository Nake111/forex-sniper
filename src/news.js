const NEWS_URL = "https://api.gdeltproject.org/api/v2/doc/doc";

export async function getForexNews() {
  const params = new URLSearchParams({
    query: '("EUR/USD" OR EURUSD OR "euro dollar" OR "European Central Bank" OR "Federal Reserve")',
    mode: "artlist",
    format: "json",
    timespan: "24h",
    maxrecords: "20",
    sort: "datedesc"
  });

  const response = await fetch(`${NEWS_URL}?${params}`);

  if (!response.ok) {
    throw new Error(`News API error: ${response.status}`);
  }

  const data = await response.json();

  return (data.articles || []).map(article => ({
    title: article.title,
    source: article.domain,
    date: article.seendate,
    url: article.url
  }));
}
