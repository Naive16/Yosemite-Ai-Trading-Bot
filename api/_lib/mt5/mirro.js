import { Mt5ProviderError } from "./adapter.js";

const DEFAULT_BASE_URL = "https://api.mirroapi.cloud/v1";

function safeError(code, status = 502, retryAfterSeconds = null) {
  const error = new Mt5ProviderError("MT5 provider request failed", code);
  error.status = status;
  error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

function required(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Mt5ProviderError(`MT5 provider field ${field} is unavailable`, "provider_response_invalid");
  return value.trim();
}

function environmentToTradeMode(value) {
  if (value === "demo" || value === "DEMO") return 0;
  if (value === "real" || value === "live" || value === "REAL" || value === "LIVE") return 2;
  if (value === "contest" || value === "CONTEST") return 1;
  throw new Mt5ProviderError("MT5 provider did not verify account environment", "account_classification_unknown");
}

export class MirroMt5Transport {
  constructor({ apiKey, accountId, baseUrl = DEFAULT_BASE_URL, timeoutMs = 10_000, fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = apiKey || "";
    this.accountId = accountId || "";
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.configured = Boolean(this.apiKey && this.accountId);
  }

  async request(path, { method = "GET", body, idempotencyKey } = {}) {
    if (!this.configured) throw safeError("provider_unconfigured", 503);
    const url = new URL(path, `${this.baseUrl.replace(/\/$/, "")}/`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: { Accept: "application/json", Authorization: `Bearer ${this.apiKey}`, ...(body ? { "content-type": "application/json" } : {}), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      let payload = null;
      if (response.status !== 204) {
        try { payload = await response.json(); } catch { throw safeError("provider_response_invalid", 502); }
      }
      if (!response.ok) {
        const providerCode = typeof payload?.error?.code === "string" ? payload.error.code : "provider_error";
        const retryAfter = Number(response.headers?.get?.("retry-after"));
        throw safeError(response.status === 401 || response.status === 403 ? "provider_authentication_failed" : providerCode, response.status === 429 ? 429 : response.status >= 500 ? 503 : 502, Number.isFinite(retryAfter) ? Math.min(300, Math.max(0, Math.ceil(retryAfter))) : null);
      }
      return payload;
    } catch (error) {
      if (error instanceof Mt5ProviderError) throw error;
      if (error?.name === "AbortError") throw safeError("provider_timeout", 504);
      throw safeError("provider_unavailable", 503);
    } finally {
      clearTimeout(timer);
    }
  }

  async getAccountInfo() {
    const raw = await this.request(`/accounts/${encodeURIComponent(this.accountId)}`);
    const info = raw?.information || raw;
    const tradeMode = environmentToTradeMode(info?.environment ?? info?.accountType ?? info?.tradeMode);
    const login = Number(info?.login ?? info?.account ?? info?.accountNumber);
    if (!Number.isSafeInteger(login) || login <= 0) throw new Mt5ProviderError("MT5 provider account identity is unavailable", "account_identity_invalid");
    return { login, trade_mode: tradeMode, server: required(info.server, "server"), company: required(info.company ?? info.broker, "company"), currency: required(info.currency, "currency"), equity: Number(info.equity ?? info.balance), capturedAt: new Date().toISOString() };
  }

  async getQuote(symbol) {
    const raw = await this.request(`/accounts/${encodeURIComponent(this.accountId)}/symbols/${encodeURIComponent(symbol)}/price`);
    return { symbol: raw?.symbol || symbol, bid: Number(raw?.bid), ask: Number(raw?.ask), timestamp: raw?.time || raw?.timestamp };
  }

  async getSymbolInfo(symbol) {
    const raw = await this.request(`/accounts/${encodeURIComponent(this.accountId)}/symbols/${encodeURIComponent(symbol)}/price`);
    const spec = raw?.specification || raw?.contract || raw?.instrument;
    if (!spec || typeof spec !== "object") throw new Mt5ProviderError("MT5 symbol specification was not supplied by the provider", "symbol_specs_incomplete");
    return { symbol: raw?.symbol || symbol, ...spec };
  }

  async getPositions() { return this.request(`/accounts/${encodeURIComponent(this.accountId)}/positions`); }
  async getOrders() { return this.request(`/accounts/${encodeURIComponent(this.accountId)}/orders`); }
  async getHistory(range = {}) {
    const query = new URLSearchParams();
    if (range.from) query.set("from", range.from);
    if (range.to) query.set("to", range.to);
    const suffix = query.toString() ? `?${query}` : "";
    return this.request(`/accounts/${encodeURIComponent(this.accountId)}/history/deals${suffix}`);
  }

  async shutdown() {}
}

export function createMirroMt5Transport(config, options = {}) {
  return new MirroMt5Transport({ ...config?.mt5?.mirro, ...options });
}
