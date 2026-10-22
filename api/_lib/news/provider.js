import { normalizeNewsItems, NewsResponseError } from "./normalize.js";

export class NewsProviderError extends Error {
  constructor(message, code, status = 502) { super(message); this.name = "NewsProviderError"; this.code = code; this.status = status; }
}

export class UnavailableNewsProvider {
  constructor(reason = "news_unavailable") { this.configured = false; this.reason = reason; }
  async getEvents() { return { status: "unavailable", reason: this.reason, items: [], source: null, qualityWarnings: ["news_context_unavailable"] }; }
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
  if (config.news.provider === "json") return new JsonNewsProvider({ ...config.news, ...options });
  return new UnavailableNewsProvider("provider_disabled");
}
