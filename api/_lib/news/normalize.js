export class NewsResponseError extends Error {
  constructor(message, code = "invalid_response") { super(message); this.name = "NewsResponseError"; this.code = code; }
}

const currencies = new Set(["EUR", "GBP", "USD", "ZAR"]);

function text(value, field, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new NewsResponseError(`${field} is invalid`);
  return value.trim();
}

function timestamp(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new NewsResponseError(`${field} is invalid`);
  return date.toISOString();
}

export function normalizeNewsItems(items, { now = new Date(), maxItems = 20 } = {}) {
  if (!Array.isArray(items)) throw new NewsResponseError("News items must be an array");
  const seen = new Set();
  const normalized = [];
  for (const item of items.slice(0, maxItems * 2)) {
    if (!item || typeof item !== "object") throw new NewsResponseError("News item is malformed");
    const title = text(item.title, "title", 300);
    const source = text(item.source || item.sourceName, "source", 120);
    const publishedAt = timestamp(item.publishedAt || item.publicationTime, "publishedAt");
    const eventAt = item.eventAt || item.eventTime ? timestamp(item.eventAt || item.eventTime, "eventAt") : null;
    const currenciesValue = Array.isArray(item.currencies) ? [...new Set(item.currencies.map((value) => String(value).toUpperCase()))] : [];
    if (currenciesValue.some((value) => !currencies.has(value))) throw new NewsResponseError("News currency relevance is invalid");
    const id = text(item.id || `${source}:${publishedAt}:${title}`, "id", 256);
    if (seen.has(id)) continue;
    seen.add(id);
    normalized.push({ id, title, summary: typeof item.summary === "string" ? item.summary.slice(0, 600) : null, source, publishedAt, eventAt, currencies: currenciesValue, url: null, freshness: { status: new Date(now).getTime() - new Date(publishedAt).getTime() > 86_400_000 ? "stale" : "fresh" } });
    if (normalized.length >= maxItems) break;
  }
  normalized.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return normalized;
}
