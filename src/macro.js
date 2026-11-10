const HIGH_IMPACT_TERMS = /\b(rate decision|interest rate|fomc|ecb|federal reserve|central bank|cpi|inflation|nonfarm payroll|\bnfp\b|unemployment|emergency meeting|currency intervention)\b/i;

function publishedAt(article) {
  const value = Date.parse(article.date ?? "");
  return Number.isFinite(value) ? value : NaN;
}

export function buildMacroContext(articles = [], now = Date.now(), calendar = { status: "UNAVAILABLE" }, market = "EURUSD") {
  const recentHighImpact = articles.filter(article => {
    const time = publishedAt(article);
    const age = now - time;
    return article.relevance === "HIGH" && HIGH_IMPACT_TERMS.test(article.title ?? "") &&
      Number.isFinite(time) && age >= 0 && age <= 90 * 60 * 1000;
  });
  const currencyRisk = calendar?.marketRisk?.[market] ?? null;
  const calendarStatus = calendar?.status === "AVAILABLE" ? "AVAILABLE" : (calendar?.status ?? "UNAVAILABLE");
  const eventRisk = currencyRisk?.status ?? "UNKNOWN";
  return {
    status: articles.length ? "NEWS_AVAILABLE" : "NEWS_UNAVAILABLE",
    calendar: {
      status: calendarStatus,
      provider: calendar?.provider ?? "Finance Calendar",
      sourceUrl: calendar?.sourceUrl ?? "https://www.financecalendar.com",
      fetchedAt: calendar?.fetchedAt ?? null,
      cacheHit: calendar?.cacheHit ?? false,
      cacheAgeMs: calendar?.cacheAgeMs ?? null,
      attribution: calendar?.attribution ?? null,
      count: calendar?.count ?? 0,
      risk: currencyRisk,
      events: calendar?.events ?? [],
      error: calendar?.error ?? null
    },
    calendarReference: {
      name: "Forex Factory",
      url: "https://www.forexfactory.com/calendar",
      integration: "EXTERNAL_REFERENCE_ONLY",
      note: "Forex Factory remains a manual reference. The engine uses a separately sourced structured economic calendar; it does not scrape or redistribute Forex Factory data."
    },
    eventRisk,
    recentHighImpactCount: recentHighImpact.length,
    headlines: recentHighImpact.slice(0, 3).map(article => ({
      title: article.title, source: article.source, date: article.date, url: article.url
    })),
    directionalBias: "UNCONFIRMED",
    note: "Economic calendar events control timing risk only. Actual-versus-consensus is shown as a numerical surprise; no currency direction is inferred without market confirmation."
  };
}
