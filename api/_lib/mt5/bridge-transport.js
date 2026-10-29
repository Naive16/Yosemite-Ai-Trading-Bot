import { createHash } from "node:crypto";

export class Mt5BridgeTransportError extends Error {
  constructor(message, code = "mt5_bridge_transport_error") {
    super(message);
    this.name = "Mt5BridgeTransportError";
    this.code = code;
  }
}

export class Mt5BridgeAccountError extends Mt5BridgeTransportError {
  constructor(message) { super(message, "mt5_bridge_account_error"); this.name = "Mt5BridgeAccountError"; }
}

export class Mt5BridgeExecutionError extends Mt5BridgeTransportError {
  constructor(message) { super(message, "mt5_bridge_execution_error"); this.name = "Mt5BridgeExecutionError"; }
}

function positive(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Mt5BridgeExecutionError(`${field} is invalid`);
  return value;
}
function requiredString(value, field, maximum = 128) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Mt5BridgeExecutionError(`${field} is invalid`);
  return value.trim();
}

/**
 * MT5 bridge transport client.
 *
 * Talks to the separately deployed MT5 demo bridge (Python, Windows VPS) over
 * HTTP. The bridge is the only component that can submit orders to an MT5 demo
 * terminal. This client never submits orders itself; it forwards a validated
 * demo order request to the bridge and returns the bridge's result.
 *
 * The bridge is opt-in: MT5_CONNECTOR must be "mt5_bridge" and
 * MT5_BRIDGE_BASE_URL must be configured. With the default connector "none"
 * no bridge is available and demo order submission returns 503 bridge_unavailable.
 */
export class Mt5BridgeTransport {
  constructor({ baseUrl, fetchImpl = globalThis.fetch, allowedAccountLogins = [], allowedServers = [], now = () => new Date() } = {}) {
    if (!baseUrl || typeof baseUrl !== "string") throw new Mt5BridgeTransportError("MT5 bridge base URL is required");
    let parsed;
    try { parsed = new URL(baseUrl); } catch { throw new Mt5BridgeTransportError("MT5 bridge base URL is invalid"); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Mt5BridgeTransportError("MT5 bridge base URL must be an HTTPS origin");
    }
    this.baseUrl = parsed.origin.replace(/\/$/, "");
    this.fetch = fetchImpl;
    this.allowedAccountLogins = [...allowedAccountLogins];
    this.allowedServers = [...allowedServers];
    this.now = now;
    this.account = null;
  }

  async _request(path, { method = "GET", body, headers = {} } = {}) {
    const url = `${this.baseUrl}${path}`;
    const init = { method, headers: { "Content-Type": "application/json", "Accept": "application/json", ...headers } };
    if (body !== undefined) init.body = JSON.stringify(body);
    let response;
    try { response = await this.fetch(url, init); } catch (error) {
      throw new Mt5BridgeTransportError(`MT5 bridge request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    let data;
    try { data = await response.json().catch(() => ({})); } catch { data = {}; }
    if (!response.ok) {
      const code = (data && data.code) || `mt5_bridge_http_${response.status}`;
      const message = (data && data.message) || `MT5 bridge returned ${response.status}`;
      if (response.status === 403) throw new Mt5BridgeAccountError(message);
      if (response.status === 503) throw new Mt5BridgeExecutionError(message);
      throw new Mt5BridgeTransportError(message);
    }
    return data;
  }

  async connect() {
    const data = await this._request("/account", { method: "GET" });
    if (!data || data.demo_confirmed !== true || data.trade_mode !== "demo") {
      throw new Mt5BridgeAccountError("Bridge did not confirm a demo account");
    }
    this._validateAllowlist(data);
    this.account = Object.freeze({
      login: data.login,
      tradeMode: data.trade_mode,
      classification: data.trade_mode === "demo" ? "demo" : "unknown",
      server: data.server,
      company: data.company,
      currency: data.currency,
      equity: data.equity,
      demoConfirmed: true,
      verifiedAt: data.verified_at_utc || this.now().toISOString(),
    });
    return Object.freeze({ status: "connected", account: { ...this.account, password: undefined }, demo: true, executionAllowed: false });
  }

  accountInfo() {
    if (!this.account) throw new Mt5BridgeTransportError("MT5 bridge account is not connected");
    return this.account;
  }

  async submitOrder(orderRequest = {}) {
    if (!this.account) throw new Mt5BridgeTransportError("MT5 bridge account is not connected");
    if (this.account.classification !== "demo") throw new Mt5BridgeAccountError("Demo-only order submission; account is not demo");
    const symbol = requiredString(orderRequest.symbol, "symbol", 32);
    const volume = positive(orderRequest.volume, "volume");
    const type = requiredString(orderRequest.type, "type");
    if (!["BUY", "SELL"].includes(type)) throw new Mt5BridgeExecutionError("MT5 order type is invalid");
    const stopLoss = orderRequest.stopLoss != null ? positive(orderRequest.stopLoss, "stopLoss") : null;
    const takeProfit = orderRequest.takeProfit != null ? positive(orderRequest.takeProfit, "takeProfit") : null;
    const comment = typeof orderRequest.comment === "string" ? requiredString(orderRequest.comment, "comment", 512) : "";

    const data = await this._request("/order", {
      method: "POST",
      body: { symbol, volume, type, stop_loss: stopLoss, take_profit: takeProfit, comment },
    });
    if (!data || data.submittedToBroker !== true || data.demo !== true || data.live === true) {
      throw new Mt5BridgeExecutionError("Bridge did not return a verified demo order result");
    }
    return Object.freeze({
      orderId: data.orderId,
      dealId: data.dealId || null,
      symbol: data.symbol,
      type: data.type,
      volume: data.volume,
      stopLoss: data.stopLoss,
      takeProfit: data.takeProfit,
      comment,
      accountLogin: data.accountLogin,
      server: data.server,
      currency: data.currency,
      status: data.status || "filled_demo",
      simulated: false,
      submittedToBroker: true,
      demo: true,
      live: false,
      executionAllowed: false,
      tradingEnabled: false,
      createdAt: data.createdAt || this.now().toISOString(),
      note: data.note || "Demo order submitted via MT5 bridge; real-money execution is not supported.",
    });
  }

  async shutdown() {
    try { await this._request("/shutdown", { method: "POST" }); } catch { /* best-effort */ }
    this.account = null;
    return { status: "stopped", executionAllowed: false };
  }

  _validateAllowlist(data) {
    const login = Number(data.login);
    const server = String(data.server || "");
    if (this.allowedAccountLogins.length && !this.allowedAccountLogins.includes(String(login))) {
      throw new Mt5BridgeAccountError(`Account login ${login} is not allowlisted`);
    }
    if (this.allowedServers.length && !this.allowedServers.includes(server)) {
      throw new Mt5BridgeAccountError(`Account server ${server} is not allowlisted`);
    }
    return true;
  }
}

export function demoOrderIdempotencyKey(userId, symbol, volume, type) {
  const payload = `${userId}:${symbol}:${volume}:${type}:${Date.now()}`;
  return `demo_${createHash("sha256").update(payload).digest("hex").slice(0, 24)}`;
}
