import { installFakeAuth, testSupabaseEnv } from "./support/fake-auth.mjs";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { clearAuthState } from "../api/_lib/auth.js";
import { setDatabaseForTests, clearDatabaseTestOverride } from "../api/_lib/database.js";
import { clearRiskRateLimit } from "../api/_lib/risk/rate-limit.js";
import { FakeDatabase } from "./support/fake-database.mjs";
import loginHandler from "../api/auth/login.js";
import backtestHandler from "../api/private/backtest.js";
import paperHandler from "../api/private/paper.js";

function responseDouble() { return { statusCode: null, headers: {}, body: null, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; }, json(body) { this.body = body; return this; } }; }
const password = "correct horse battery staple";

const originalEnv = { ...process.env };
const database = new FakeDatabase();
let cookie = "";
let csrfToken = "";

before(async () => {
  Object.assign(process.env, { APP_ENV: "test", APP_ORIGIN: "http://localhost:3000", TRADING_MODE: "disabled", LIVE_TRADING_ENABLED: "false", ...testSupabaseEnv, MARKET_DATA_PROVIDER: "none" });
  database.reset();
  clearAuthState();
  clearRiskRateLimit();
  setDatabaseForTests(database); installFakeAuth(database);
  const login = responseDouble();
  await loginHandler({ method: "POST", headers: { origin: "http://localhost:3000", "x-real-ip": "simulation-login", "content-type": "application/json" }, body: { email: "operator@example.test", password } }, login);
  cookie = "Bearer " + login.body.session.access_token;
  csrfToken = "unused-bearer-flow";
});

after(() => { clearAuthState(); clearRiskRateLimit(); clearDatabaseTestOverride(); for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv); });

const request = (path, method = "GET", headers = {}, body) => ({ method, url: path, headers: { origin: "http://localhost:3000", "x-real-ip": "simulation-api", ...(cookie ? { authorization: cookie } : {}), ...headers }, ...(body === undefined ? {} : { body }) });

test("simulation APIs require authentication and report safe unavailable states", async () => {
  const anonymous = responseDouble();
  await backtestHandler(request("/api/private/backtest", "GET", { authorization: "" }), anonymous);
  assert.equal(anonymous.statusCode, 401);

  const backtest = responseDouble();
  await backtestHandler(request("/api/private/backtest"), backtest);
  assert.equal(backtest.statusCode, 503);
  assert.equal(backtest.body.code, "historical_provider_unavailable");

  const paper = responseDouble();
  await paperHandler(request("/api/private/paper"), paper);
  assert.equal(paper.statusCode, 200);
  assert.equal(paper.body.simulated, true);
  assert.equal(paper.body.live, false);
  assert.equal(paper.body.executionAllowed, false);
  assert.equal(paper.body.running, false);
});

test("simulation mutation surfaces require bearer authentication and reject browser-supplied events", async () => {
  const missingCsrf = responseDouble();
  await backtestHandler(request("/api/private/backtest", "POST", { "content-type": "application/json", authorization: "" }, JSON.stringify({ symbol: "EUR/USD", timeframe: "M15" })), missingCsrf);
  assert.equal(missingCsrf.statusCode, 401);

  const clientEvent = responseDouble();
  await paperHandler(request("/api/private/paper", "POST", { "content-type": "application/json", "x-csrf-token": csrfToken }, JSON.stringify({ price: 1.1 })), clientEvent);
  assert.equal(clientEvent.statusCode, 400);
  assert.equal(clientEvent.body.code, "client_data_not_allowed");
});
