import { normalizeNewsItems, NewsResponseError } from "./normalize.js";

export class NewsProviderError extends Error {
  constructor(message, code, status = 502) { super(message); this.name = "NewsProviderError"; this.code = code; this.status = status; }
}

export class UnavailableNewsProvider {
  constructor(reason = "news_unavailable") { this.configured = false; this.reason = reason; }
  async getEvents() { return { status: "unavailable", reason: this.reason, items: [], source: null, qualityWarnings: ["news_context_unavailable"] }; }
}

function decodeXml(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
    const parsed = code[0].toLowerCase() === "x" ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10);
    return Number.isSafeInteger(parsed) ? String.fromCodePoint(parsed) : "";
  }).replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[name]);
}

function textFromXml(value) { return decodeXml(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }

function tagValue(xml, tag, { required = true } = {}) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  const value = match ? textFromXml(match[1]) : "";
  if (required && !value) throw new NewsProviderError("BBC returned an invalid RSS item", "invalid_response", 502);
  return value || null;
}

export function parseBbcRss(xml, { now = new Date() } = {}) {
  if (typeof xml !== "string" || !/<rss(?:\s|>)/i.test(xml) || !/<channel(?:\s|>)/i.test(xml)) throw new NewsProviderError("BBC returned an invalid RSS feed", "invalid_response", 502);
  const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => {
    const item = match[1];
    const title = tagValue(item, "title");
    const link = tagValue(item, "link");
    const publishedAt = tagValue(item, "pubDate");
    const description = tagValue(item, "description", { required: false });
    const id = tagValue(item, "guid", { required: false }) || link;
    return { id, title, url: link, summary: description, source: "BBC News", publishedAt, currencies: [] };
  });
  try { return normalizeNewsItems(items, { now }); }
  catch (error) { if (error instanceof NewsResponseError) throw new NewsProviderError("BBC returned invalid news data", "invalid_response", 502); throw error; }
}

export class BbcNewsProvider {
  constructor({ feedUrl, timeoutMs = 4_000, fetchImpl = globalThis.fetch } = {}) { this.configured = Boolean(feedUrl); this.feedUrl = feedUrl; this.timeoutMs = timeoutMs; this.fetchImpl = fetchImpl; }
  async getEvents({ now = new Date() } = {}) {
    if (!this.configured) return { status: "unavailable", reason: "missing_feed", items: [], source: null, qualityWarnings: ["news_context_unavailable"] };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.feedUrl, { headers: { Accept: "application/rss+xml, application/xml, text/xml" }, signal: controller.signal });
      if (!response.ok) throw new NewsProviderError("BBC news request failed", response.status === 429 ? "rate_limit" : "provider_error", response.status === 429 ? 429 : 502);
      const items = parseBbcRss(await response.text(), { now });
      return { status: "available", reason: null, items, source: "bbc-news-rss", qualityWarnings: items.some((item) => item.freshness.status === "stale") ? ["stale_news_items"] : [] };
    } catch (error) {
      if (error instanceof NewsProviderError) throw error;
      throw new NewsProviderError("BBC news is unavailable", error?.name === "AbortError" ? "timeout" : "provider_failure", error?.name === "AbortError" ? 504 : 502);
    } finally { clearTimeout(timer); }
  }
}

export class JsonNewsProvider {
  constructor({ feedUrl, apiKey, timeoutMs = 4_000, fetchImpl = globalThis.fetch } = {}) { this.configured = Boolean(feedUrl && apiKey); this.feedUrl = feedUrl; this.apiKey = apiKey; this.timeoutMs = timeoutMs; this.fetchImpl = fetchImpl; }
  async getEvents({ now = new Date() } = {}) {
    if (!this.configured) return { status: "unavailable", reason: "missing_credentials", items: [], source: null, qualityWarnings: ["news_context_unavailable"] };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.feedUrl, { headers: { Accept: "application/json", Authorization: `Bearer ${this.apiKey}` }, signal: controller.signal });
      if (!response.ok) throw new NewsProviderError("News provider request failed", response.status === 429 ? "rate_limit" : "provider_error", response.status === 429 ? 429 : 502);
      const body = await response.json();
      const items = normalizeNewsItems(body.items || body.articles || body.events, { now });
      return { status: "available", reason: null, items, source: "configured-json-feed", qualityWarnings: items.some((item) => item.freshness.status === "stale") ? ["stale_news_items"] : [] };
    } catch (error) {
      if (error instanceof NewsProviderError) throw error;
      if (error instanceof NewsResponseError) throw new NewsProviderError("News provider returned invalid data", "invalid_response", 502);
      throw new NewsProviderError("News context is unavailable", error.name === "AbortError" ? "timeout" : "provider_failure", error.name === "AbortError" ? 504 : 502);
    } finally { clearTimeout(timer); }
  }
}

export function createNewsProvider(config, options = {}) {
  if (!config.news?.configured) return new UnavailableNewsProvider(config.news?.provider === "none" ? "provider_disabled" : "missing_credentials");
  if (config.news.provider === "bbc") return new BbcNewsProvider({ ...config.news, ...options });
  if (config.news.provider === "json") return new JsonNewsProvider({ ...config.news, ...options });
  return new UnavailableNewsProvider("provider_disabled");
}
