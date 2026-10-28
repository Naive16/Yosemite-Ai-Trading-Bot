import { installFakeAuth, testSupabaseEnv } from "./support/fake-auth.mjs";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { clearAuthState } from "../api/_lib/auth.js";
import { setDatabaseForTests, clearDatabaseTestOverride } from "../api/_lib/database.js";
import { clearAiRateLimit } from "../api/_lib/ai/rate-limit.js";
import { FakeDatabase } from "./support/fake-database.mjs";
import loginHandler from "../api/auth/login.js";
import analysisHandler from "../api/private/analysis.js";

function responseDouble() { return { statusCode: null, headers: {}, body: null, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; }, json(body) { this.body = body; return this; } }; }
const password = "correct horse battery staple";

const originalEnv = { ...process.env };
const database = new FakeDatabase();
let cookie = "";

function request(url = "/api/private/analysis?symbol=EUR%2FUSD&timeframe=M15", withCookie = cookie) { return { method: "GET", url, headers: { origin: "http://localhost:3000", "x-real-ip": "analysis-test", ...(withCookie ? { authorization: withCookie } : {}) } }; }

before(async () => {
  Object.assign(process.env, { APP_ENV: "test", APP_ORIGIN: "http://localhost:3000", TRADING_MODE: "disabled", LIVE_TRADING_ENABLED: "false", ...testSupabaseEnv, MARKET_DATA_PROVIDER: "none", ANTHROPIC_API_KEY: "" });
  database.reset(); clearAuthState(); clearAiRateLimit(); setDatabaseForTests(database); installFakeAuth(database);
  const login = responseDouble(); await loginHandler({ method: "POST", headers: { origin: "http://localhost:3000", "x-real-ip": "analysis-login", "content-type": "application/json" }, body: { email: "operator@example.test", password } }, login); cookie = "Bearer " + login.body.session.access_token;
});

after(() => { clearAuthState(); clearAiRateLimit(); clearDatabaseTestOverride(); for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv); });

test("analysis endpoint requires auth and validates its allowlist", async () => {
  const anonymous = responseDouble(); await analysisHandler(request("/api/private/analysis?symbol=EUR%2FUSD", ""), anonymous); assert.equal(anonymous.statusCode, 401);
  const invalid = responseDouble(); await analysisHandler(request("/api/private/analysis?symbol=BTC%2FUSD"), invalid); assert.equal(invalid.statusCode, 400);
});

test("analysis endpoint safely reports missing Claude or market-data configuration and rate limits", async () => {
  const first = responseDouble(); await analysisHandler(request(), first); assert.equal(first.statusCode, 503); assert.equal(first.body.recommendation, "NO TRADE");
  process.env.AI_RATE_LIMIT_MAX_REQUESTS = "1";
  clearAiRateLimit();
  const limitedFirst = responseDouble(); await analysisHandler(request(), limitedFirst); assert.equal(limitedFirst.statusCode, 503);
  const limitedSecond = responseDouble(); await analysisHandler(request(), limitedSecond); assert.equal(limitedSecond.statusCode, 429);
});
