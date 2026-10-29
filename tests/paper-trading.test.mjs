import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { PaperEngine, PaperValidationError, PaperInsufficientFundsError } from "../api/_lib/paper/engine.js";
import { installFakeAuth, testSupabaseEnv } from "./support/fake-auth.mjs";
import { clearAuthState } from "../api/_lib/auth.js";
import { setDatabaseForTests, clearDatabaseTestOverride } from "../api/_lib/database.js";
import { FakeDatabase } from "./support/fake-database.mjs";
import loginHandler from "../api/auth/login.js";
import paperTradingHandler from "../api/private/paper-trading.js";

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
    headers: { origin: "http://localhost:3000", "x-real-ip": "paper-test", ...(cookie ? { authorization: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body })
  };
}

const nowIso = new Date().toISOString();
const proposal = {
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
    rewardRisk: 2,
    expiresAt: new Date(Date.now() + 3600_000).toISOString()
  }
};

const quote = {
  symbol: "EUR/USD",
  price: 1.1,
  timestamp: nowIso,
  dataMode: "live",
  source: "test"
};

before(async () => {
  Object.assign(process.env, { APP_ENV: "test", APP_ORIGIN: "http://localhost:3000", TRADING_MODE: "disabled", LIVE_TRADING_ENABLED: "false", ...testSupabaseEnv, MARKET_DATA_PROVIDER: "none" });
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

test("paper engine loads initial state from empty database", async () => {
  const engine = new PaperEngine({ db: database, userId: "legacy-operator", startingEquity: 10_000, conversionRates: { "EUR/USD": 1.1 } });
  const state = await engine.load();
  assert.equal(state.mode, "paper_simulation");
  assert.equal(state.simulated, true);
  assert.equal(state.live, false);
  assert.equal(state.executionAllowed, false);
  assert.equal(state.tradingEnabled, false);
  assert.equal(state.equity, 10_000);
  assert.deepEqual(state.positions, []);
  assert.deepEqual(state.trades, []);
});

test("paper engine opens a simulated position from an approved proposal", async () => {
  const engine = new PaperEngine({ db: database, userId: "legacy-operator", startingEquity: 10_000, conversionRates: { "EUR/USD": 1.1 } });
  await engine.load();
  const eventId = `paper_test_${Date.now()}`;
  const freshQuote = { ...quote, timestamp: new Date().toISOString() };
  const result = await engine.openPosition({ eventId, proposal, quote: freshQuote, now: new Date() });
  assert.equal(result.status, "opened_simulated");
  assert.equal(result.simulated, true);
  assert.equal(result.live, false);
  assert.ok(result.position.id);
  assert.equal(result.position.symbol, "EUR/USD");
  assert.equal(result.position.direction, "BUY");
  assert.ok(result.equityAfter <= 10_000);
  assert.ok(result.volume > 0);
});

test("paper engine rejects unapproved proposals", async () => {
  const engine = new PaperEngine({ db: database, userId: "legacy-operator", startingEquity: 10_000, conversionRates: { "EUR/USD": 1.1 } });
  await engine.load();
  const unapproved = { ...proposal, status: "pending_approval" };
  await assert.rejects(() => engine.openPosition({ eventId: "evt_1", proposal: unapproved, quote }), PaperValidationError);
});

test("paper engine rejects proposals with risk not PASS", async () => {
  const engine = new PaperEngine({ db: database, userId: "legacy-operator", startingEquity: 10_000, conversionRates: { "EUR/USD": 1.1 } });
  await engine.load();
  const blockedRisk = { ...proposal, immutableContent: { ...proposal.immutableContent, risk: { decision: "BLOCKED" } } };
  await assert.rejects(() => engine.openPosition({ eventId: "evt_2", proposal: blockedRisk, quote }), PaperValidationError);
});

test("paper engine rejects stale quotes", async () => {
  const engine = new PaperEngine({ db: database, userId: "legacy-operator", startingEquity: 10_000, conversionRates: { "EUR/USD": 1.1 } });
  await engine.load();
  const staleQuote = { ...quote, timestamp: "2026-10-21T10:00:00.000Z" };
  await assert.rejects(() => engine.openPosition({ eventId: "evt_3", proposal, quote: staleQuote, now: new Date("2026-10-21T11:59:45Z") }), PaperValidationError);
});

test("paper engine closes a position and records realized P&L", async () => {
  const engine = new PaperEngine({ db: database, userId: "legacy-operator", startingEquity: 10_000, conversionRates: { "EUR/USD": 1.1 } });
  await engine.load();
  const openNow = new Date();
  const openResult = await engine.openPosition({ eventId: `paper_close_${Date.now()}`, proposal, quote: { ...quote, timestamp: openNow.toISOString() }, now: openNow });
  const closeNow = new Date(openNow.getTime() + 60_000);
  const closeQuote = { ...quote, price: 1.105, timestamp: closeNow.toISOString() };
  const closeResult = await engine.closePosition({ positionId: openResult.position.id, quote: closeQuote, now: closeNow });
  assert.equal(closeResult.status, "closed_simulated");
  assert.equal(closeResult.simulated, true);
  assert.equal(closeResult.live, false);
  assert.ok(closeResult.tradeId);
  assert.ok(typeof closeResult.netPnl === "number");
});

test("paper engine rejects closing unknown position", async () => {
  const engine = new PaperEngine({ db: database, userId: "legacy-operator", startingEquity: 10_000, conversionRates: { "EUR/USD": 1.1 } });
  await engine.load();
  await assert.rejects(() => engine.closePosition({ positionId: "paper_nonexistent", quote, now: new Date() }), PaperValidationError);
});

test("paper API handler requires authentication", async () => {
  const res = responseDouble();
  await paperTradingHandler(request("/api/private/paper-trading", "GET", { authorization: "" }), res);
  assert.equal(res.statusCode, 401);
});

test("paper API handler returns paper state for authenticated operator", async () => {
  const res = responseDouble();
  await paperTradingHandler(request("/api/private/paper-trading", "GET"), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.simulated, true);
  assert.equal(res.body.live, false);
  assert.equal(res.body.executionAllowed, false);
  assert.equal(res.body.tradingEnabled, false);
  assert.equal(res.body.mode, "paper_simulation");
});

test("paper API handler opens a position via POST", async () => {
  const res = responseDouble();
  await paperTradingHandler(request("/api/private/paper-trading", "POST", { "content-type": "application/json" }, JSON.stringify({
    action: "open",
    eventId: `paper_api_${Date.now()}`,
    proposal,
    quote
  })), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.simulated, true);
  assert.equal(res.body.status, "opened_simulated");
  assert.ok(res.body.position.id);
});

test("paper API handler closes a position via POST", async () => {
  // First open a position
  const openRes = responseDouble();
  const eventId = `paper_close_api_${Date.now()}`;
  await paperTradingHandler(request("/api/private/paper-trading", "POST", { "content-type": "application/json" }, JSON.stringify({ action: "open", eventId, proposal, quote })), openRes);
  const positionId = openRes.body.position.id;

  // Then close it
  const closeRes = responseDouble();
  await paperTradingHandler(request("/api/private/paper-trading", "POST", { "content-type": "application/json" }, JSON.stringify({
    action: "close",
    positionId,
    quote: { ...quote, price: 1.105 }
  })), closeRes);
  assert.equal(closeRes.statusCode, 200);
  assert.equal(closeRes.body.status, "closed_simulated");
  assert.ok(typeof closeRes.body.netPnl === "number");
});

test("paper API handler rejects invalid actions", async () => {
  const res = responseDouble();
  await paperTradingHandler(request("/api/private/paper-trading", "POST", { "content-type": "application/json" }, JSON.stringify({ action: "invalid" })), res);
  assert.equal(res.statusCode, 400);
});

test("paper trading never enables live execution", async () => {
  const engine = new PaperEngine({ db: database, userId: "legacy-operator", startingEquity: 10_000, conversionRates: { "EUR/USD": 1.1 } });
  await engine.load();
  const snap = engine.snapshot();
  assert.equal(snap.live, false);
  assert.equal(snap.executionAllowed, false);
  assert.equal(snap.tradingEnabled, false);
  assert.equal(snap.simulated, true);
  // The config test separately verifies that MT5_EXECUTION_ENABLED and LIVE_TRADING_ENABLED remain blocked
});
