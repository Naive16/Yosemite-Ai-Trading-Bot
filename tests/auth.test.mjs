import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { AuthClient } from "@supabase/auth-js";
import { clearAuthState, setAuthClientFactoryForTests } from "../api/_lib/auth.js";
import { loadConfig, ConfigurationError } from "../api/_lib/config.js";
import { DatabaseQueryError, setDatabaseForTests, clearDatabaseTestOverride } from "../api/_lib/database.js";
import { FakeDatabase } from "./support/fake-database.mjs";
import { fakeTokens, installFakeAuth, issueFakeSession, testSupabaseEnv } from "./support/fake-auth.mjs";
import loginHandler from "../api/auth/login.js";
import meHandler from "../api/auth/me.js";
import logoutHandler from "../api/auth/logout.js";
import configHandler from "../api/auth/config.js";
import { routes } from "../api/_lib/routes.js";

const originalEnv = { ...process.env };
let database; let state;
const responseDouble = () => ({ statusCode: null, headers: {}, body: null, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; }, json(body) { this.body = body; return this; } });
const request = ({ method = "GET", token = "", origin = "http://localhost:3000", body, ...rest } = {}) => ({ method, headers: { origin, ...(token ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body, ...rest });
async function invoke(handler, req) { const res = responseDouble(); await handler(req, res); return res; }

beforeEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv, { APP_ENV: "test", APP_ORIGIN: "http://localhost:3000", TRADING_MODE: "disabled", LIVE_TRADING_ENABLED: "false", WORKER_ENABLED: "false", MT5_EXECUTION_ENABLED: "false", ...testSupabaseEnv });
  database = new FakeDatabase(); setDatabaseForTests(database); state = installFakeAuth(database);
});
after(() => { clearAuthState(); clearDatabaseTestOverride(); for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv); });

test("every protected dashboard API rejects missing credentials and legacy cookies", async () => {
  for (const [route, handler] of routes.filter(([key]) => key.startsWith("GET /api/private/"))) {
    const response = await invoke(handler, request({ url: route.slice(4) }));
    assert.equal(response.statusCode, 401, route);
    const cookie = await invoke(handler, { method: "GET", url: route.slice(4), headers: { cookie: "yosemite_session=" + "x".repeat(43) } });
    assert.equal(cookie.statusCode, 401, route);
  }
});

test("authorized Supabase sign-in restores across requests, logout rejects replayed access tokens", async () => {
  const login = await invoke(loginHandler, request({ method: "POST", body: { email: "operator@example.test", password: "correct horse battery staple" } }));
  assert.equal(login.statusCode, 200);
  assert.equal(login.headers["Cache-Control"], "no-store");
  assert.equal(login.headers["Set-Cookie"], undefined);
  const token = login.body.session.access_token;
  assert.equal((await invoke(meHandler, request({ token }))).body.user.username, "operator");
  assert.equal((await invoke(meHandler, request({ token }))).statusCode, 200);
  const logout = await invoke(logoutHandler, request({ method: "POST", token }));
  assert.equal(logout.statusCode, 200);
  // Fake getUser still accepts this signed JWT, just as an unexpired token can remain cryptographically valid.
  assert.equal(fakeTokens.get(token).active, false);
  assert.equal((await invoke(meHandler, request({ token }))).statusCode, 401);
});

test("invalid credentials, invalid/expired tokens and unapproved users are distinguished", async () => {
  const badLogin = await invoke(loginHandler, request({ method: "POST", body: { email: "operator@example.test", password: "incorrect" } }));
  assert.equal(badLogin.statusCode, 401); assert.equal(badLogin.body.message, "Invalid email or password");
  for (const token of ["bad", "a.b.c", issueFakeSession({ expiresAt: Date.now() - 1000 }).access_token]) assert.equal((await invoke(meHandler, request({ token }))).statusCode, 401);
  const denied = issueFakeSession({ authorized: false });
  assert.equal((await invoke(meHandler, request({ token: denied.access_token }))).statusCode, 403);
  const forged = issueFakeSession({ authorized: false });
  const spoofed = request({ token: forged.access_token }); spoofed.headers["x-user-id"] = "legacy-operator"; spoofed.headers["x-role"] = "admin";
  assert.equal((await invoke(meHandler, spoofed)).statusCode, 403);
});

test("all protected APIs preserve membership denials and Auth outages without disguising them", async () => {
  const token = issueFakeSession({ authorized: false }).access_token;
  for (const [route, handler] of routes.filter(([key]) => key.startsWith("GET /api/private/"))) {
    const response = await invoke(handler, request({ token, url: route.slice(4) }));
    assert.equal(response.statusCode, 403, route);
    assert.equal(response.body.code, "dashboard_access_denied", route);
  }
  state.authUnavailable = true;
  for (const [route, handler] of routes.filter(([key]) => key.startsWith("GET /api/private/"))) {
    const response = await invoke(handler, request({ token, url: route.slice(4) }));
    assert.equal(response.statusCode, 503, route);
    assert.equal(response.body.code, "authentication_unavailable", route);
  }
});

test("provider outage, database outage, and logout failure fail closed with accurate safe errors", async () => {
  const token = issueFakeSession().access_token;
  state.authUnavailable = true;
  let response = await invoke(meHandler, request({ token }));
  assert.equal(response.statusCode, 503); assert.equal(response.body.code, "authentication_unavailable");
  state.authUnavailable = false;
  const verify = database.verifySession;
  database.verifySession = async () => { throw new DatabaseQueryError("synthetic failure", new Error("private-credential-marker")); };
  response = await invoke(meHandler, request({ token }));
  assert.equal(response.statusCode, 503); assert.equal(response.body.message, "Database unavailable");
  assert.equal(JSON.stringify(response).includes("private-credential-marker"), false);
  database.verifySession = verify;
  state.logoutUnavailable = true;
  response = await invoke(logoutHandler, request({ method: "POST", token }));
  assert.equal(response.statusCode, 503); assert.match(response.body.message, /could not be confirmed/);
  assert.equal(fakeTokens.get(token).active, true);
});

test("public config exposes only public connection fields; production misconfiguration is 503", async () => {
  let response = await invoke(configHandler, request());
  assert.equal(response.statusCode, 200);
  assert.deepEqual(Object.keys(response.body).sort(), ["registrationEnabled", "status", "supabase"]);
  assert.equal(response.body.registrationEnabled, false);
  assert.deepEqual(Object.keys(response.body.supabase).sort(), ["publishableKey", "url"]);
  process.env.APP_ENV = "production"; delete process.env.SUPABASE_PUBLISHABLE_KEY; delete process.env.SUPABASE_ANON_KEY;
  for (const handler of [configHandler, meHandler, loginHandler]) {
    response = await invoke(handler, request({ method: handler === loginHandler ? "POST" : "GET" }));
    assert.equal(response.statusCode, 503);
  }
});

test("logout cleanup remains possible for an already missing or expired Supabase session", async () => {
  const token = issueFakeSession().access_token;
  fakeTokens.get(token).active = false;
  for (const status of [401, 403, 404]) {
    state.signOutError = { status };
    assert.equal((await invoke(logoutHandler, request({ method: "POST", token }))).statusCode, 200);
  }
  assert.equal((await invoke(meHandler, request({ token }))).statusCode, 401);
});

test("invalid project keys and disabled providers are configuration failures rather than bad passwords", async () => {
  for (const error of [{ status: 401, message: "Invalid API key" }, { status: 400, code: "email_provider_disabled" }]) {
    state.signInError = error;
    const result = await invoke(loginHandler, request({ method: "POST", body: { email: "operator@example.test", password: "correct horse battery staple" } }));
    assert.equal(result.statusCode, 503); assert.equal(result.body.code, "configuration_invalid");
    const token = issueFakeSession().access_token;
    state.signOutError = error;
    assert.equal((await invoke(logoutHandler, request({ method: "POST", token }))).statusCode, 503);
  }
});

test("cross-origin writes are forbidden and Supabase rate limits preserve 429", async () => {
  let response = await invoke(loginHandler, request({ method: "POST", origin: "https://attacker.example", body: { email: "operator@example.test", password: "correct horse battery staple" } }));
  assert.equal(response.statusCode, 403);
  const token = issueFakeSession().access_token;
  response = await invoke(logoutHandler, request({ method: "POST", token, origin: "https://attacker.example" }));
  assert.equal(response.statusCode, 403); assert.equal(fakeTokens.get(token).active, true);
  state.signInError = { status: 429 };
  response = await invoke(loginHandler, request({ method: "POST", body: { email: "operator@example.test", password: "wrong" } }));
  assert.equal(response.statusCode, 429);
});

test("the real official SDK validates identity through the intended Auth endpoint", async () => {
  const token = issueFakeSession().access_token; const calls = [];
  setAuthClientFactoryForTests((config) => ({ auth: new AuthClient({
    url: config.supabase.url + "/auth/v1", headers: { apikey: config.supabase.publishableKey },
    persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
    fetch: async (url, options) => { calls.push({ url: String(url), authorization: new Headers(options.headers).get("Authorization") }); return new Response(JSON.stringify(fakeTokens.get(token).user), { headers: { "content-type": "application/json" }, status: 200 }); }
  }) }));
  const response = await invoke(meHandler, request({ token }));
  assert.equal(response.statusCode, 200);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, testSupabaseEnv.SUPABASE_URL + "/auth/v1/user");
  assert.equal(calls[0].authorization, "Bearer " + token);
});

test("all execution and broker configuration remains disabled", () => {
  const config = loadConfig({ APP_ENV: "test", ...testSupabaseEnv });
  assert.equal(config.tradingMode, "disabled"); assert.equal(config.liveTradingEnabled, false); assert.equal(config.worker.enabled, false); assert.equal(config.mt5.enabled, false); assert.equal(config.mt5.executionEnabled, false); assert.equal(config.mt5.connector, "none");
  for (const override of [{ LIVE_TRADING_ENABLED: "true" }, { WORKER_ENABLED: "true" }, { TRADING_MODE: "simulation" }, { MT5_EXECUTION_ENABLED: "true" }, { MT5_DEMO_MODE: "true" }]) assert.throws(() => loadConfig({ APP_ENV: "test", ...testSupabaseEnv, ...override }), ConfigurationError);
});
