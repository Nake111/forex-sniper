import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyArticle,
  isSafeArticleUrl,
  normalizeArticles
} from "./src/news.js";

test("news URLs accept only HTTP and HTTPS", () => {
  assert.equal(isSafeArticleUrl("https://example.com/story"), true);
  assert.equal(isSafeArticleUrl("http://example.com/story"), true);
  assert.equal(isSafeArticleUrl("javascript:alert(1)"), false);
  assert.equal(isSafeArticleUrl("not-a-url"), false);
});

test("a generic central-bank mention is not classified as high impact", () => {
  const result = classifyArticle({
    title: "Federal Reserve officials discuss the economic outlook"
  });
  assert.notEqual(result.relevance, "HIGH");
});

test("a specific rate decision can be classified as high impact", () => {
  const result = classifyArticle({
    title: "Federal Reserve announces interest rate decision"
  });
  assert.equal(result.relevance, "HIGH");
});

test("normalization drops invalid URLs and old articles", () => {
  const now = new Date().toISOString();
  const articles = normalizeArticles([
    { title: "ECB policy update", url: "https://example.com/1", date: now },
    { title: "Unsafe article", url: "javascript:alert(1)", date: now },
    { title: "Old article", url: "https://example.com/2", date: "2020-01-01T00:00:00Z" }
  ]);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].title, "ECB policy update");
});

test("normalization rejects a malformed provider payload", () => {
  assert.throws(() => normalizeArticles({ articles: [] }), /invalid article list/i);
});
