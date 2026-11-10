const HIGH_IMPACT_TERMS = /\b(rate decision|interest rate|fomc|ecb|federal reserve|central bank|cpi|inflation|nonfarm payroll|\bnfp\b|unemployment|emergency meeting|currency intervention)\b/i;

function publishedAt(article) {
  const value = Date.parse(article.date ?? "");
  return Number.isFinite(value) ? value : NaN;
}

export function buildMacroContext(articles = [], now = Date.now()) {
  const recentHighImpact = articles.filter(article => {
    const time = publishedAt(article);
    const age = now - time;
    return article.relevance === "HIGH" && HIGH_IMPACT_TERMS.test(article.title ?? "") &&
      Number.isFinite(time) && age >= 0 && age <= 90 * 60 * 1000;
  });
  return {
    status: articles.length ? "NEWS_AVAILABLE" : "NEWS_UNAVAILABLE",
    calendarReference: { name: "Forex Factory", url: "https://www.forexfactory.com/calendar", integration: "EXTERNAL_REFERENCE_ONLY", note: "Open the live calendar at Forex Factory. Its schedule is not copied into this application; no official public API is documented and redistribution requires permission." },
    eventRisk: recentHighImpact.length ? "HIGH" : articles.length ? "NORMAL" : "UNKNOWN",
    recentHighImpactCount: recentHighImpact.length,
    headlines: recentHighImpact.slice(0, 3).map(article => ({
      title: article.title, source: article.source, date: article.date, url: article.url
    })),
    directionalBias: "UNCONFIRMED",
    note: "News headlines are context, not a verified economic calendar or directional trading signal."
  };
}
