import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../api/_lib/config.js";
import { BbcNewsProvider, NewsProviderError, parseBbcRss } from "../api/_lib/news/provider.js";

const feed = (items) => "<?xml version=\"1.0\"?><rss version=\"2.0\"><channel><title>BBC News</title>" + items + "</channel></rss>";
const item = ({ id, title = "Markets update", link = "https://www.bbc.com/news/example", pubDate = "Thu, 22 Oct 2026 10:00:00 GMT", description = "Verified description" }) => "<item><guid>" + id + "</guid><title><![CDATA[" + title + "]]></title><link>" + link + "</link><pubDate>" + pubDate + "</pubDate><description><![CDATA[" + description + "]]></description></item>";

test("BBC RSS parsing validates URLs, timestamps, deduplicates, and marks stale stories", () => {
  const result = parseBbcRss(feed([
    item({ id: "fresh", title: "Fresh &amp; verified" }),
    item({ id: "fresh", title: "Duplicate must be ignored", link: "https://www.bbc.com/news/duplicate" }),
    item({ id: "old", pubDate: "Tue, 20 Oct 2026 10:00:00 GMT" })
  ].join("")), { now: new Date("2026-10-22T12:00:00Z") });
  assert.equal(result.length, 2);
  assert.equal(result[0].source, "BBC News");
  assert.equal(result[0].url, "https://www.bbc.com/news/example");
  assert.equal(result[0].title, "Fresh & verified");
  assert.equal(result[1].freshness.status, "stale");
});

test("BBC RSS parsing rejects malformed feeds and unsafe links", () => {
  assert.throws(() => parseBbcRss("<rss><channel><item></item></channel></rss>"), (error) => error instanceof NewsProviderError && error.code === "invalid_response");
  assert.throws(() => parseBbcRss(feed(item({ id: "bad", link: "javascript:alert(1)" }))), (error) => error instanceof NewsProviderError && error.code === "invalid_response");
});

test("BBC provider uses a mocked response and fails closed on unavailable feeds", async () => {
  const provider = new BbcNewsProvider({ feedUrl: "https://feeds.bbci.co.uk/news/business/rss.xml", fetchImpl: async () => new Response(feed(item({ id: "one" })), { status: 200 }) });
  const result = await provider.getEvents({ now: new Date("2026-10-22T12:00:00Z") });
  assert.equal(result.status, "available");
  assert.equal(result.source, "bbc-news-rss");
  const unavailable = new BbcNewsProvider({ feedUrl: "https://feeds.bbci.co.uk/news/business/rss.xml", fetchImpl: async () => new Response("", { status: 503 }) });
  await assert.rejects(() => unavailable.getEvents(), (error) => error.code === "provider_error");
});

test("BBC is the configured default without credentials and remains server-side", () => {
  const config = loadConfig({ APP_ENV: "test", APP_ORIGIN: "http://localhost:3000", NEWS_PROVIDER: "bbc" });
  assert.equal(config.news.provider, "bbc");
  assert.equal(config.news.configured, true);
  assert.match(config.news.feedUrl, /^https:\/\/feeds\.bbci\.co\.uk\//);
});
