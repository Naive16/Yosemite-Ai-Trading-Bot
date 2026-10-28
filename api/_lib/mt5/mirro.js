import { Mt5ProviderError } from "./adapter.js";

const DEFAULT_BASE_URL = "https://api.mirroapi.cloud/v1";
const MAX_RESPONSE_BYTES = 512 * 1024;
const READ_ERROR_CODES = new Set(["BAD_REQUEST", "NOT_FOUND", "RATE_LIMITED", "API_BUSY", "INTERNAL", "BOOK_UNAVAILABLE", "HISTORY_UNAVAILABLE", "SYMBOL_CATALOG_UNAVAILABLE", "QUOTE_STALE", "TERMINAL_UNAVAILABLE", "TERMINAL_READ_TIMEOUT", "TERMINAL_READ_INVALID", "TERMINAL_CLOCK_UNCERTAIN", "TERMINAL_READ_UNAVAILABLE", "TERMINAL_READ_CANCELLED", "EA_UPGRADE_REQUIRED", "NOT_IMPLEMENTED"]);

function safeError(code, status = 502, retryAfterSeconds = null) {
  const error = new Mt5ProviderError("MT5 provider request failed", code);
  Object.assign(error, { status, retryAfterSeconds });
  return error;
}
function required(value, field, maximum = 128) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new Mt5ProviderError(`MT5 provider field ${field} is unavailable`, "provider_response_invalid");
  return value.trim();
}
function decimal(value, field, { nullable = false, positive = false } = {}) {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || (positive && Number(value) <= 0)) throw new Mt5ProviderError(`MT5 provider field ${field} is unavailable`, "provider_response_invalid");
  return Number(value);
}
function date(value, field, nullable = false) {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || Number.isNaN(Date.parse(value))) throw new Mt5ProviderError(`MT5 provider field ${field} is unavailable`, "provider_response_invalid");
  return new Date(value).toISOString();
}
async function readJson(response) {
  if (Number(response.headers?.get?.("content-length")) > MAX_RESPONSE_BYTES) { await response.body?.cancel?.(); throw safeError("provider_response_too_large"); }
  if (!response.body?.getReader) return response.json(); // Injected test transports may provide only json().
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw safeError("provider_response_too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Read-only preparation. This class cannot provision accounts or send trades.
// MirroAPI's current public contract does not attest MT5 ACCOUNT_TRADE_MODE or
// supply every native risk-sizing field. Never infer either from labels.
export class MirroMt5Transport {
  #apiKey; #accountId; #baseUrl; #fetch; #timeoutMs; #now;
  constructor({ apiKey, accountId, baseUrl = DEFAULT_BASE_URL, timeoutMs = 10_000, fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
    this.#apiKey = apiKey || ""; this.#accountId = accountId || ""; this.#fetch = fetchImpl; this.#now = now;
    let url;
    try { url = new URL(baseUrl); } catch { throw safeError("provider_configuration_invalid", 503); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 || typeof fetchImpl !== "function") throw safeError("provider_configuration_invalid", 503);
    if ((this.#accountId && !/^[A-Za-z0-9_-]{1,128}$/.test(this.#accountId)) || typeof this.#apiKey !== "string" || /[\u0000-\u001f\u007f]/.test(this.#apiKey)) throw safeError("provider_configuration_invalid", 503);
    this.#baseUrl = url.toString().replace(/\/$/, "") + "/"; this.#timeoutMs = timeoutMs;
    this.configured = Boolean(this.#apiKey && this.#accountId);
  }
  #accountPath(suffix = "") { return `/accounts/${encodeURIComponent(this.#accountId)}${suffix}`; }
  async request(path, options = {}) {
    if ((options.method && options.method !== "GET") || options.body !== undefined || options.idempotencyKey !== undefined) throw safeError("provider_read_only", 403);
    if (!this.configured) throw safeError("provider_unconfigured", 503);
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || /[\\#\u0000-\u001f]/.test(path)) throw safeError("provider_read_path_invalid", 400);
    const [pathname, query = "", ...extraQueries] = path.split("?");
    const account = this.#accountPath();
    const known = ["/capabilities", "/platforms", account, `${account}/information`, `${account}/positions`, `${account}/orders`, `${account}/history/deals`].includes(pathname);
    const symbolPath = pathname.startsWith(`${account}/symbols/`) && /^\/[^/]+\/(?:price|specification)$/.test(pathname.slice(`${account}/symbols`.length));
    const queryNames = pathname.endsWith("/history/deals") ? ["from", "to", "ticket", "positionId", "cursor", "limit"] : pathname.endsWith("/price") ? ["maxAgeSeconds"] : [];
    if ((!known && !symbolPath) || path.length > 8192 || extraQueries.length || path.includes("..") || /%2e/i.test(path) || [...new URLSearchParams(query).keys()].some((name) => !queryNames.includes(name))) throw safeError("provider_read_path_invalid", 400);
    // A leading slash would discard /v1. Only known relative read paths reach fetch.
    const url = new URL(path.slice(1), this.#baseUrl);
    const base = new URL(this.#baseUrl);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw safeError("provider_read_path_invalid", 400);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(url, { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${this.#apiKey}` }, redirect: "error", signal: controller.signal });
      let payload;
      try { payload = await readJson(response); } catch (error) { if (error instanceof Mt5ProviderError || controller.signal.aborted) throw error; if (response.ok) throw safeError("provider_response_invalid"); }
      if (!response.ok) {
        const code = READ_ERROR_CODES.has(payload?.error?.code) ? payload.error.code : "provider_error";
        const retry = response.headers?.get?.("retry-after"); const seconds = retry && /^\d+$/.test(retry) ? Math.min(300, Number(retry)) : null;
        throw safeError([401, 403].includes(response.status) ? "provider_authentication_failed" : code, response.status === 429 ? 429 : response.status >= 500 ? 503 : 502, seconds);
      }
      return payload;
    } catch (error) {
      if (error instanceof Mt5ProviderError) throw error;
      throw safeError(controller.signal.aborted ? "provider_timeout" : "provider_unavailable", controller.signal.aborted ? 504 : 503);
    } finally { clearTimeout(timer); }
  }
  async getCapabilities() { return this.request("/capabilities"); }
  async getPlatforms() { return this.request("/platforms"); }
  async getAccountSnapshot() {
    const metadata = await this.request(this.#accountPath());
    const info = await this.request(this.#accountPath("/information"));
    if (metadata?.id !== this.#accountId || metadata?.platform !== "mt5") throw safeError("account_identity_invalid");
    const login = Number(metadata.login); const server = required(info?.server, "server");
    if (!Number.isSafeInteger(login) || login <= 0 || server !== metadata.server || !["demo", "live", null].includes(metadata.environment) || !["CREATED", "DEPLOYING", "DEPLOYED", "UNDEPLOYING", "UNDEPLOYED", "FAILED"].includes(metadata.state) || !["CONNECTED", "DISCONNECTED", "BROKER_DOWN", "FIRM_UNREACHABLE"].includes(metadata.connection)) throw safeError("account_identity_invalid");
    const capturedAt = date(info.updatedAt, "updatedAt", true);
    const ageSeconds = capturedAt ? (this.#now().getTime() - Date.parse(capturedAt)) / 1000 : null;
    return Object.freeze({ provider: "mirro", providerAccountId: metadata.id, platform: "mt5", login, server, company: required(info.broker, "broker"), currency: required(info.currency, "currency", 3), declaredEnvironment: metadata.environment, equity: decimal(info.equity, "equity"), balance: decimal(info.balance, "balance"), margin: decimal(info.margin, "margin"), freeMargin: decimal(info.freeMargin, "freeMargin"), dayStartEquity: decimal(info.dayStartEquity, "dayStartEquity", { nullable: true }), state: metadata.state, connection: metadata.connection, brokerConnected: info.brokerConnected === true, tradeAllowed: info.tradeAllowed === true, followerRole: metadata.roles?.follower === true, executionCertified: metadata.executionCertified === true, capturedAt, freshness: { status: ageSeconds !== null && ageSeconds >= -5 && ageSeconds <= 120 ? "fresh" : "unverified", ageSeconds }, verification: "unverified", executionAllowed: false });
  }
  async getAccountInfo() {
    await this.getAccountSnapshot();
    throw new Mt5ProviderError("Provider metadata does not attest the broker's MT5 account trade mode", "account_classification_unverified");
  }
  async getQuote(symbol) {
    required(symbol, "symbol", 64);
    const raw = await this.request(this.#accountPath(`/symbols/${encodeURIComponent(symbol)}/price?maxAgeSeconds=15`));
    if (raw?.symbol !== symbol || raw.source !== "terminal" || raw.timeBasis !== "utc" || raw.stale !== false || typeof raw.ageSeconds !== "number" || !Number.isFinite(raw.ageSeconds) || raw.ageSeconds < -5 || raw.ageSeconds > 15) throw safeError("quote_unverified");
    const timestamp = date(raw.time, "time"); const observedAt = date(raw.observedAt, "observedAt"); const receivedAt = date(raw.receivedAt, "receivedAt");
    const age = (this.#now().getTime() - Date.parse(timestamp)) / 1000;
    if (age < -5 || age > 15) throw safeError("quote_stale");
    const bid = decimal(raw.bid, "bid", { positive: true }); const ask = decimal(raw.ask, "ask", { positive: true });
    if (ask < bid) throw safeError("quote_invalid");
    return { symbol, bid, ask, timestamp, source: "terminal", timeBasis: "utc", observedAt, receivedAt };
  }
  async getSymbolSpecification(symbol) {
    required(symbol, "symbol", 64);
    const raw = await this.request(this.#accountPath(`/symbols/${encodeURIComponent(symbol)}/specification`));
    if (raw?.symbol !== symbol) throw safeError("symbol_mismatch");
    return { symbol, contractSize: decimal(raw.contractSize, "contractSize", { nullable: true }), volumeMin: decimal(raw.volumeMin, "volumeMin", { nullable: true }), volumeMax: decimal(raw.volumeMax, "volumeMax", { nullable: true }), volumeStep: decimal(raw.volumeStep, "volumeStep", { nullable: true }), tickSize: decimal(raw.tickSize, "tickSize", { nullable: true }), tickValue: decimal(raw.tickValue, "tickValue", { nullable: true }), tradeMode: typeof raw.tradeMode === "string" ? raw.tradeMode : null, tradable: typeof raw.tradable === "boolean" ? raw.tradable : null, source: ["account-catalogue", "broker-catalogue"].includes(raw.source) ? raw.source : null, verifiedAt: date(raw.verifiedAt, "verifiedAt", true), verification: "incomplete", executionAllowed: false };
  }
  async getSymbolInfo(symbol) {
    await this.getSymbolSpecification(symbol);
    throw new Mt5ProviderError("Provider specification does not supply all native execution and risk-sizing fields", "symbol_specs_incomplete");
  }
  async getPositions() { const rows = await this.request(this.#accountPath("/positions")); if (!Array.isArray(rows)) throw safeError("provider_response_invalid"); return rows; }
  async getOrders() { const rows = await this.request(this.#accountPath("/orders")); if (!Array.isArray(rows)) throw safeError("provider_response_invalid"); return rows; }
  async getHistory(range = {}) {
    const query = new URLSearchParams();
    for (const key of ["from", "to", "ticket", "positionId", "cursor", "limit"]) if (range[key] !== undefined) query.set(key, String(range[key]));
    const suffix = query.size ? `?${query}` : "";
    const page = await this.request(this.#accountPath(`/history/deals${suffix}`));
    if (!Array.isArray(page?.items) || !(page.nextCursor === null || typeof page.nextCursor === "string")) throw safeError("provider_response_invalid");
    return { items: page.items, nextCursor: page.nextCursor };
  }
  async shutdown() {}
}
export function createMirroMt5Transport(config, options = {}) { return new MirroMt5Transport({ ...config?.mt5?.mirro, ...options }); }
