export const MT5_TRADE_MODES = Object.freeze({ DEMO: 0, CONTEST: 1, REAL: 2 });

export class Mt5ProviderError extends Error {
  constructor(message, code = "mt5_provider_error") { super(message); this.name = "Mt5ProviderError"; this.code = code; }
}

export class Mt5ExecutionBlockedError extends Mt5ProviderError {
  constructor(message = "MT5 order submission is disabled") { super(message, "execution_disabled"); this.name = "Mt5ExecutionBlockedError"; }
}

export class Mt5ValidationError extends Mt5ProviderError {
  constructor(message, code = "mt5_invalid_response") { super(message, code); this.name = "Mt5ValidationError"; }
}

function requiredString(value, field, maximum = 128) { if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Mt5ValidationError(`${field} is invalid`); return value.trim(); }
function positive(value, field) { if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Mt5ValidationError(`${field} is invalid`); return value; }
function timestamp(value, field) { const date = new Date(value); if (Number.isNaN(date.getTime())) throw new Mt5ValidationError(`${field} is invalid`); return date.toISOString(); }

export function classifyMt5Account(raw) {
  if (!raw || typeof raw !== "object") throw new Mt5ValidationError("MT5 account response is unavailable", "account_unavailable");
  if (!Number.isInteger(raw.trade_mode) || !Object.values(MT5_TRADE_MODES).includes(raw.trade_mode)) throw new Mt5ValidationError("MT5 account classification is unknown", "account_classification_unknown");
  const login = Number(raw.login);
  if (!Number.isSafeInteger(login) || login <= 0) throw new Mt5ValidationError("MT5 account login is invalid", "account_identity_invalid");
  return Object.freeze({ login, tradeMode: raw.trade_mode, classification: raw.trade_mode === MT5_TRADE_MODES.DEMO ? "demo" : raw.trade_mode === MT5_TRADE_MODES.CONTEST ? "contest" : "real", server: requiredString(raw.server, "server"), company: requiredString(raw.company, "company"), currency: requiredString(raw.currency, "currency", 3).toUpperCase(), equity: positive(raw.equity, "equity"), capturedAt: timestamp(raw.capturedAt ?? new Date(), "capturedAt") });
}

export function assertAllowedDemoAccount(account, mt5Config) {
  if (!mt5Config?.demoMode || mt5Config.executionEnabled) throw new Mt5ValidationError("MT5 demo execution mode is not enabled", "demo_mode_not_enabled");
  if (account.classification !== "demo") throw new Mt5ValidationError("Provider did not positively identify a demo account", "demo_account_required");
  if (!mt5Config.allowedAccountLogins.includes(String(account.login))) throw new Mt5ValidationError("MT5 account is not allowlisted", "account_not_allowlisted");
  if (!mt5Config.allowedServers.includes(account.server)) throw new Mt5ValidationError("MT5 server is not allowlisted", "server_not_allowlisted");
  return true;
}

export function normalizeMt5Symbol(raw) {
  if (!raw || typeof raw !== "object") throw new Mt5ValidationError("MT5 symbol response is unavailable", "symbol_unavailable");
  const symbol = requiredString(raw.symbol, "symbol", 32);
  if (raw.visible !== true || raw.tradeMode === "disabled") throw new Mt5ValidationError("MT5 symbol is not tradable", "symbol_unavailable");
  return Object.freeze({ symbol, visible: true, tradeMode: requiredString(String(raw.tradeMode ?? "unknown"), "tradeMode", 32), contractSize: positive(raw.contractSize, "contractSize"), volumeMin: positive(raw.volumeMin, "volumeMin"), volumeMax: positive(raw.volumeMax, "volumeMax"), volumeStep: positive(raw.volumeStep, "volumeStep"), point: positive(raw.point, "point"), tickSize: positive(raw.tickSize, "tickSize"), tickValue: positive(raw.tickValue, "tickValue"), fillingModes: Array.isArray(raw.fillingModes) && raw.fillingModes.length ? [...new Set(raw.fillingModes.map((mode) => requiredString(String(mode), "fillingMode", 32)))] : (() => { throw new Mt5ValidationError("MT5 filling modes are unavailable", "symbol_specs_incomplete"); })() });
}

export function normalizeMt5Quote(raw, { now = new Date(), maxAgeSeconds = 120 } = {}) {
  if (!raw || typeof raw !== "object") throw new Mt5ValidationError("MT5 quote is unavailable", "quote_unavailable");
  const symbol = requiredString(raw.symbol, "symbol", 32); const bid = positive(raw.bid, "bid"); const ask = positive(raw.ask, "ask"); const capturedAt = timestamp(raw.timestamp, "timestamp");
  const age = (new Date(now).getTime() - new Date(capturedAt).getTime()) / 1_000;
  if (age < -5 || age > maxAgeSeconds) throw new Mt5ValidationError("MT5 quote is stale or from the future", "quote_stale");
  if (ask < bid) throw new Mt5ValidationError("MT5 quote spread is invalid", "quote_invalid");
  return Object.freeze({ symbol, bid, ask, spread: ask - bid, timestamp: capturedAt, freshness: { status: "fresh", ageSeconds: age } });
}

export class Mt5Adapter {
  constructor({ transport, config, now = () => new Date() } = {}) { if (!transport || typeof transport.getAccountInfo !== "function") throw new Mt5ProviderError("MT5 transport is not configured", "transport_unavailable"); this.transport = transport; this.config = config; this.now = now; this.account = null; }
  async connect() { const account = classifyMt5Account(await this.transport.getAccountInfo()); assertAllowedDemoAccount(account, this.config); this.account = account; return Object.freeze({ status: "connected", account: { ...account, password: undefined }, demo: true, executionAllowed: false }); }
  async accountInfo() { if (!this.account) throw new Mt5ProviderError("MT5 account is not connected", "not_connected"); return this.account; }
  async symbolInfo(symbol) { if (!this.account) throw new Mt5ProviderError("MT5 account is not connected", "not_connected"); const normalized = normalizeMt5Symbol(await this.transport.getSymbolInfo(symbol)); if (normalized.symbol !== symbol) throw new Mt5ValidationError("MT5 returned a different symbol", "symbol_mismatch"); return normalized; }
  async quote(symbol) { if (!this.account) throw new Mt5ProviderError("MT5 account is not connected", "not_connected"); const quote = normalizeMt5Quote(await this.transport.getQuote(symbol), { now: this.now() }); if (quote.symbol !== symbol) throw new Mt5ValidationError("MT5 returned a different quote symbol", "symbol_mismatch"); return quote; }
  async positions() { if (!this.account) throw new Mt5ProviderError("MT5 account is not connected", "not_connected"); return this.transport.getPositions(); }
  async orders() { if (!this.account) throw new Mt5ProviderError("MT5 account is not connected", "not_connected"); return this.transport.getOrders(); }
  async history(range) { if (!this.account) throw new Mt5ProviderError("MT5 account is not connected", "not_connected"); return this.transport.getHistory(range); }
  async submitOrder() { throw new Mt5ExecutionBlockedError(); }
  async shutdown() { if (typeof this.transport.shutdown === "function") await this.transport.shutdown(); this.account = null; return { status: "stopped", executionAllowed: false }; }
}
