import { getSymbolDefinition, getTimeframeDefinition, listSupportedTimeframes, SYMBOL_REGISTRY } from "./symbols.js";
import { normalizeCandles, normalizeQuote, MarketDataResponseError } from "./normalize.js";

export class MarketDataProviderError extends Error {
  constructor(message, code, status = 502, retryAfterSeconds = null) {
    super(message);
    this.name = "MarketDataProviderError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class UnavailableMarketDataProvider {
  constructor(reason = "missing_credentials") {
    this.id = "none";
    this.source = "none";
    this.reason = reason;
  }

  get configured() { return false; }
  supportedTimeframes() { return listSupportedTimeframes(); }
  async getQuote() { throw new MarketDataProviderError("Market data provider is unavailable", this.reason, 503); }
  async getCandles() { throw new MarketDataProviderError("Market data provider is unavailable", this.reason, 503); }
}

function retryAfter(response) {
  const value = response.headers?.get?.("retry-after") || "";
  return /^\d+$/.test(value) ? Number(value) : null;
}

function responseError(status, retrySeconds) {
  if (status === 429) return new MarketDataProviderError("Market data provider rate limit reached", "rate_limit", 429, retrySeconds);
  if (status === 401 || status === 403) return new MarketDataProviderError("Market data provider credentials were rejected", "provider_auth", 503);
  if (status === 404) return new MarketDataProviderError("Market data symbol is unavailable", "symbol_unavailable", 404);
  if (status >= 500 || status === 408) return new MarketDataProviderError("Market data provider failed", "provider_failure", 502);
  return new MarketDataProviderError("Market data provider rejected the request", "provider_request", 502);
}

async function wait(milliseconds) {
  if (milliseconds > 0) await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class TwelveDataProvider {
  constructor({ apiKey, baseUrl, timeoutMs = 5_000, maxRetries = 1, fetchImpl = globalThis.fetch, sleep = wait } = {}) {
    if (!apiKey) throw new MarketDataProviderError("Twelve Data credentials are missing", "missing_credentials", 503);
    this.id = "twelvedata";
    this.source = "Twelve Data";
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
  }

  get configured() { return true; }
  supportedTimeframes() { return listSupportedTimeframes(); }

  async request(path, params) {
    const url = new URL(path, `${this.baseUrl}/`);
    for (const [key, value] of Object.entries({ ...params, apikey: this.apiKey })) url.searchParams.set(key, String(value));
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
        clearTimeout(timeout);
        if (!response.ok) {
          const error = responseError(response.status, retryAfter(response));
          if ((response.status === 408 || response.status === 429 || response.status >= 500) && attempt < this.maxRetries) {
            await this.sleep(Math.min(1_000, 100 * 2 ** attempt));
            continue;
          }
          throw error;
        }
        let body;
        try { body = await response.json(); } catch { throw new MarketDataProviderError("Market data provider returned malformed JSON", "invalid_response", 502); }
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new MarketDataProviderError("Market data provider returned malformed data", "invalid_response", 502);
        if (body.status === "error" || body.code || body.message && !body.values && !body.close && !body.price) {
          const providerMessage = String(body.message || body.error || "").toLowerCase();
          if (/market.*(closed|close)|not trading|outside.*hours/.test(providerMessage)) throw new MarketDataProviderError("Market is closed or the provider has no current session", "market_closed", 503);
          throw new MarketDataProviderError("Market data provider returned an error", body.code === "429" ? "rate_limit" : "provider_error", body.code === "429" ? 429 : 502);
        }
        return body;
      } catch (error) {
        clearTimeout(timeout);
        if (error.name === "AbortError" || error.code === "UND_ERR_ABORTED") {
          if (attempt < this.maxRetries) { await this.sleep(Math.min(1_000, 100 * 2 ** attempt)); continue; }
          throw new MarketDataProviderError("Market data provider timed out", "timeout", 504);
        }
        if (error instanceof MarketDataProviderError) throw error;
        if (attempt < this.maxRetries) { await this.sleep(Math.min(1_000, 100 * 2 ** attempt)); continue; }
        throw new MarketDataProviderError("Market data provider request failed", "provider_failure", 502);
      }
    }
    throw new MarketDataProviderError("Market data provider request failed", "provider_failure", 502);
  }

  async getQuote(symbol, options = {}) {
    const definition = getSymbolDefinition(symbol);
    if (!definition) throw new MarketDataProviderError("Market data symbol is unavailable", "symbol_unavailable", 404);
    const body = await this.request("/quote", { symbol: definition.providerSymbol });
    try {
      return normalizeQuote(body, { symbol, source: this.source, dataMode: "live", staleAfterSeconds: options.staleAfterSeconds });
    } catch (error) {
      if (error instanceof MarketDataResponseError) throw new MarketDataProviderError(error.message, error.code, 502);
      throw error;
    }
  }

  async getCandles(symbol, timeframe, limit = 90) {
    const symbolDefinition = getSymbolDefinition(symbol);
    const timeframeDefinition = getTimeframeDefinition(timeframe);
    if (!symbolDefinition) throw new MarketDataProviderError("Market data symbol is unavailable", "symbol_unavailable", 404);
    if (!timeframeDefinition) throw new MarketDataProviderError("Market data timeframe is unsupported", "timeframe_unavailable", 400);
    const body = await this.request("/time_series", { symbol: symbolDefinition.providerSymbol, interval: timeframeDefinition.providerInterval, outputsize: limit, timezone: "UTC" });
    try {
      const normalized = normalizeCandles(body.values, { symbol, timeframe, timeframeSeconds: timeframeDefinition.seconds, source: this.source, dataMode: "live", maxCandles: limit });
      return { ...normalized, source: this.source, dataMode: "live", supportedTimeframes: this.supportedTimeframes() };
    } catch (error) {
      if (error instanceof MarketDataResponseError) throw new MarketDataProviderError(error.message, error.code, 502);
      throw error;
    }
  }
}

export function createMarketDataProvider(config, options = {}) {
  if (!config.marketData?.configured) return new UnavailableMarketDataProvider(config.marketData?.provider === "none" ? "provider_disabled" : "missing_credentials");
  if (config.marketData.provider === "twelvedata") return new TwelveDataProvider({ ...config.marketData, ...options });
  return new UnavailableMarketDataProvider("provider_disabled");
}

export function registrySymbols() {
  return Object.keys(SYMBOL_REGISTRY);
}
