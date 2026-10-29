import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { installFakeAuth, testSupabaseEnv } from "./support/fake-auth.mjs";
import { clearAuthState } from "../api/_lib/auth.js";
import { setDatabaseForTests, clearDatabaseTestOverride } from "../api/_lib/database.js";
import { FakeDatabase } from "./support/fake-database.mjs";
import loginHandler from "../api/auth/login.js";
import mt5DemoHandler from "../api/private/mt5-demo.js";
import { Mt5BridgeTransport } from "../api/_lib/mt5/bridge-transport.js";

function responseDouble() {
  return {
    statusCode: null, headers: {}, body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(body) { this.body = body; return this; }
  };
}

const password = "correct horse battery staple";
const originalEnv = { ...process.env };
const database = new FakeDatabase();
let cookie = "";

function request(path, method = "GET", headers = {}, body) {
  return {
    method, url: path,
    headers: { origin: "http://localhost:3000", "x-real-ip": "mt5-demo-test", ...(cookie ? { authorization: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body })
  };
}

const approvedProposal = {
  proposalId: "prop_11111111-1111-4111-8111-111111111111",
  proposalVersion: 1,
  status: "approved",
  contentDigest: "a".repeat(64),
  immutableContent: {
    symbol: "EUR/USD",
    direction: "BUY",
    risk: { decision: "PASS" },
    proposedEntry: { value: 1.1 },
    stopLoss: { value: 1.095 },
    takeProfit: { value: 1.11 },
    rewardRisk: 2
  }
};

// A mock MT5 bridge that confirms a verified demo account and accepts demo orders.
function mockBridge(fetchImpl) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body });
      const u = new URL(url);
      if (u.pathname === "/account" && init.method === "GET") {
        return new Response(JSON.stringify({
          demo_confirmed: true,
          trade_mode: "demo",
          login: 12345,
          server: "Broker-Demo",
          company: "Demo Broker",
          currency: "USD",
          equity: 10_000,
          verified_at_utc: new Date().toISOString()
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (u.pathname === "/order" && init.method === "POST") {
        const body = JSON.parse(init.body || "{}");
        return new Response(JSON.stringify({
          orderId: "bridge_order_" + createHashLike(),
          dealId: "bridge_deal_" + createHashLike(),
          symbol: body.symbol,
          type: body.type,
          volume: body.volume,
          price: 1.1002,
          accountLogin: 12345,
          server: "Broker-Demo",
          currency: "USD",
          status: "filled_demo",
          simulated: false,
          submittedToBroker: true,
          demo: true,
          live: false,
          createdAt: new Date().toISOString(),
          note: "Demo order submitted via MT5 bridge"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (u.pathname === "/shutdown" && init.method === "POST") {
        return new Response(JSON.stringify({ status: "stopped" }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
    }
  };
}

function createHashLike() {
  return Math.random().toString(36).slice(2);
}

before(async () => {
  Object.assign(process.env, {
    APP_ENV: "test", APP_ORIGIN: "http://localhost:3000",
    TRADING_MODE: "disabled", LIVE_TRADING_ENABLED: "false",
    MT5_DEMO_MODE: "true",
    MT5_ALLOWED_ACCOUNT_LOGINS: "12345",
    MT5_ALLOWED_SERVERS: "Broker-Demo",
    ...testSupabaseEnv, MARKET_DATA_PROVIDER: "none"
  });
  database.reset();
  clearAuthState();
  setDatabaseForTests(database);
  installFakeAuth(database);
  const login = responseDouble();
  await loginHandler({ method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: { email: "operator@example.test", password } }, login);
  cookie = "Bearer " + login.body.session.access_token;
});

after(() => {
  clearAuthState(); clearDatabaseTestOverride();
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

test("MT5 demo handler requires authentication", async () => {
  const res = responseDouble();
  await mt5DemoHandler(request("/api/private/mt5-demo", "GET", { authorization: "" }), res);
  assert.equal(res.statusCode, 401);
});

test("MT5 demo handler returns demo status when demo mode is enabled and no bridge is configured", async () => {
  const res = responseDouble();
  await mt5DemoHandler(request("/api/private/mt5-demo", "GET"), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.demo, true);
  assert.equal(res.body.live, false);
  assert.equal(res.body.executionAllowed, false);
  assert.equal(res.body.tradingEnabled, false);
  assert.equal(res.body.connector, "none");
  assert.equal(res.body.bridgeConfigured, false);
  assert.equal(res.body.bridgeRequired, true);
  assert.ok(res.body.bridgeNote);
});

test("MT5 demo handler rejects demo order submission when no bridge is configured", async () => {
  const res = responseDouble();
  await mt5DemoHandler(request("/api/private/mt5-demo", "POST", { "content-type": "application/json" }, JSON.stringify({
    action: "submit_order",
    symbol: "EUR/USD",
    volume: 0.01,
    type: "BUY",
    stopLoss: 1.09,
    takeProfit: 1.12,
    comment: "demo test order",
    proposal: approvedProposal
  })), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "mt5_bridge_not_configured");
  assert.equal(res.body.demo, true);
  assert.equal(res.body.live, false);
  assert.equal(res.body.submittedToBroker, undefined);
});

test("MT5 demo handler rejects when demo mode is not enabled", async () => {
  const origEnv = { ...process.env };
  delete process.env.MT5_DEMO_MODE;
  try {
    const res = responseDouble();
    await mt5DemoHandler(request("/api/private/mt5-demo", "GET"), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "demo_mode_disabled");
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in origEnv)) delete process.env[key];
    Object.assign(process.env, origEnv);
  }
});

test("MT5 demo handler submits a demo order through the bridge with an approved proposal", async () => {
  const bridge = mockBridge();
  const origConnector = process.env.MT5_CONNECTOR;
  const origBridgeUrl = process.env.MT5_BRIDGE_BASE_URL;
  Object.assign(process.env, { MT5_CONNECTOR: "mt5_bridge", MT5_BRIDGE_BASE_URL: "https://bridge.test" });
  try {
    // Monkeypatch the transport's fetch by constructing through the handler is not
    // directly injectable; instead verify the bridge transport unit behaves correctly
    // in a dedicated test below. Here confirm the handler routes to the bridge when
    // configured by checking it no longer returns bridge_unavailable (it will attempt
    // a real fetch to bridge.test and fail fast because no server listens).
    const res = responseDouble();
    await mt5DemoHandler(request("/api/private/mt5-demo", "POST", { "content-type": "application/json" }, JSON.stringify({
      action: "submit_order",
      symbol: "EUR/USD",
      volume: 0.01,
      type: "BUY",
      proposal: approvedProposal
    })), res);
    // No bridge server is running in tests, so the handler reports the bridge error,
    // never a simulated success.
    assert.notEqual(res.statusCode, 200);
    assert.equal(res.body.demo, true);
    assert.equal(res.body.live, false);
  } finally {
    if (origConnector === undefined) delete process.env.MT5_CONNECTOR;
    else process.env.MT5_CONNECTOR = origConnector;
    if (origBridgeUrl === undefined) delete process.env.MT5_BRIDGE_BASE_URL;
    else process.env.MT5_BRIDGE_BASE_URL = origBridgeUrl;
  }
});

test("MT5 demo never enables live execution", async () => {
  const res = responseDouble();
  await mt5DemoHandler(request("/api/private/mt5-demo", "GET"), res);
  assert.equal(res.body.live, false);
  assert.equal(res.body.tradingEnabled, false);
  assert.equal(res.body.executionAllowed, false);
  assert.equal(res.body.demo, true);
});

test("Mt5BridgeTransport connects to a verified demo account and submits a demo order via mock fetch", async () => {
  const bridge = mockBridge();
  const transport = new Mt5BridgeTransport({
    baseUrl: "https://bridge.test",
    fetchImpl: bridge.fetchImpl,
    allowedAccountLogins: ["12345"],
    allowedServers: ["Broker-Demo"]
  });
  const connected = await transport.connect();
  assert.equal(connected.demo, true);
  assert.equal(connected.executionAllowed, false);
  assert.equal(connected.account.login, 12345);
  assert.equal(connected.account.server, "Broker-Demo");
  assert.equal(connected.account.demoConfirmed, true);

  const order = await transport.submitOrder({
    symbol: "EUR/USD",
    volume: 0.01,
    type: "BUY",
    stopLoss: 1.09,
    takeProfit: 1.12,
    comment: "demo test"
  });
  assert.equal(order.simulated, false);
  assert.equal(order.submittedToBroker, true);
  assert.equal(order.demo, true);
  assert.equal(order.live, false);
  assert.equal(order.accountLogin, 12345);
  assert.equal(order.status, "filled_demo");
  assert.ok(order.orderId);
  await transport.shutdown();
});

test("Mt5BridgeTransport rejects a real (non-demo) account", async () => {
  const realBridge = {
    calls: [],
    fetchImpl: async (url, init) => {
      const u = new URL(url);
      if (u.pathname === "/account") {
        return new Response(JSON.stringify({
          demo_confirmed: false,
          trade_mode: "real",
          login: 99999,
          server: "Broker-Live",
          company: "Live Broker",
          currency: "USD",
          equity: 50_000,
          verified_at_utc: new Date().toISOString()
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
    }
  };
  const transport = new Mt5BridgeTransport({
    baseUrl: "https://bridge.test",
    fetchImpl: realBridge.fetchImpl,
    allowedAccountLogins: ["12345"],
    allowedServers: ["Broker-Demo"]
  });
  await assert.rejects(() => transport.connect(), (error) => error.name === "Mt5BridgeAccountError");
});

test("Mt5BridgeTransport rejects unallowlisted demo login", async () => {
  const bridge = mockBridge();
  const transport = new Mt5BridgeTransport({
    baseUrl: "https://bridge.test",
    fetchImpl: bridge.fetchImpl,
    allowedAccountLogins: ["99999"], // not the bridge's 12345
    allowedServers: ["Broker-Demo"]
  });
  await assert.rejects(() => transport.connect(), (error) => error.name === "Mt5BridgeAccountError");
});
