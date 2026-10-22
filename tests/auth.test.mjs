import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, clearAuthState } from "../api/_lib/auth.js";
import { loadConfig, ConfigurationError } from "../api/_lib/config.js";
import loginHandler from "../api/auth/login.js";
import meHandler from "../api/auth/me.js";
import logoutHandler from "../api/auth/logout.js";
import privateStatusHandler from "../api/private/status.js";
import operationsHandler from "../api/private/operations.js";
import { setDatabaseForTests, clearDatabaseTestOverride } from "../api/_lib/database.js";
import { FakeDatabase } from "./support/fake-database.mjs";

const password = "correct horse battery staple";
const passwordHash = await hashPassword(password, { N: 1_024, r: 1, p: 1 });
const originalEnv = { ...process.env };
const database = new FakeDatabase();

function configureAuth(overrides = {}) {
  Object.assign(process.env, {
    APP_ENV: "test",
    APP_ORIGIN: "http://localhost:3000",
    TRADING_MODE: "disabled",
    LIVE_TRADING_ENABLED: "false",
    AUTH_USERNAME: "operator",
    AUTH_PASSWORD_HASH: passwordHash,
    SESSION_SECRET: "a".repeat(32),
    DATABASE_URL: "postgresql://test:test@example.test/test",
    SESSION_TTL_SECONDS: "1800",
    AUTH_RATE_LIMIT_WINDOW_SECONDS: "900",
    AUTH_RATE_LIMIT_MAX_ATTEMPTS: "5",
    ...overrides
  });
}

function responseDouble() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(body) { this.body = body; return this; }
  };
}

function request({ method = "GET", body, cookie = "", csrf = "", origin = "http://localhost:3000", ip = "auth-test" } = {}) {
  const headers = { origin, "x-real-ip": ip };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (cookie) headers.cookie = cookie;
  if (csrf) headers["x-csrf-token"] = csrf;
  return { method, headers, body };
}

function cookieFrom(response) {
  assert.match(response.headers["Set-Cookie"], /^yosemite_session=[A-Za-z0-9_-]{40,64};/);
  return response.headers["Set-Cookie"].split(";", 1)[0];
}

before(() => {
  configureAuth();
  clearAuthState();
  setDatabaseForTests(database);
});

after(() => {
  clearAuthState();
  clearDatabaseTestOverride();
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

test("password hashing verifies the password and rejects another password", async () => {
  assert.equal(await verifyPassword(password, passwordHash), true);
  assert.equal(await verifyPassword("not the configured password", passwordHash), false);
});

test("configuration rejects live trading and production without required secrets", () => {
  assert.throws(() => loadConfig({ APP_ENV: "test", LIVE_TRADING_ENABLED: "true" }), ConfigurationError);
  assert.throws(() => loadConfig({ APP_ENV: "production", AUTH_USERNAME: "operator", AUTH_PASSWORD_HASH: passwordHash }), ConfigurationError);
  const config = loadConfig({ APP_ENV: "production", APP_ORIGIN: "https://example.com", AUTH_USERNAME: "operator", AUTH_PASSWORD_HASH: passwordHash, SESSION_SECRET: "a".repeat(32), DATABASE_URL: "postgresql://user:secret@example.test/db" });
  assert.equal(config.appOrigin, "https://example.com");
  assert.equal(config.liveTradingEnabled, false);
});

test("login validates input and does not leak credential details", async () => {
  const response = responseDouble();
  await loginHandler(request({ method: "POST", body: { username: "operator", password: "short" } }), response);
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.message, "Password is invalid");

  const invalid = responseDouble();
  await loginHandler(request({ method: "POST", body: { username: "operator", password: "wrong password value" }, ip: "invalid-test" }), invalid);
  assert.equal(invalid.statusCode, 401);
  assert.equal(invalid.body.message, "Invalid username or password");
  assert.equal(Object.hasOwn(invalid.body, "user"), false);
});

test("successful login creates an HttpOnly session and protected routes require it", async () => {
  const loginResponse = responseDouble();
  await loginHandler(request({ method: "POST", body: { username: "operator", password } }), loginResponse);
  assert.equal(loginResponse.statusCode, 200);
  assert.match(loginResponse.headers["Set-Cookie"], /HttpOnly/);
  assert.match(loginResponse.headers["Set-Cookie"], /SameSite=Lax/);
  assert.equal(loginResponse.headers["Cache-Control"], "no-store");
  const cookie = cookieFrom(loginResponse);
  const csrfToken = loginResponse.body.csrfToken;

  // A new simulated serverless instance has no in-memory session state, but the shared database still validates the session.
  clearAuthState();

  const meResponse = responseDouble();
  await meHandler(request({ cookie }), meResponse);
  assert.equal(meResponse.statusCode, 200);
  assert.equal(meResponse.body.user.username, "operator");

  const privateResponse = responseDouble();
  await privateStatusHandler(request({ cookie }), privateResponse);
  assert.equal(privateResponse.statusCode, 200);
  assert.equal(privateResponse.body.tradingEnabled, false);

  const operationsResponse = responseDouble();
  await operationsHandler(request({ cookie }), operationsResponse);
  assert.equal(operationsResponse.statusCode, 503);
  assert.equal(operationsResponse.body.services.execution.state, "blocked");
  assert.equal(operationsResponse.body.services.database.state, "healthy");

  const anonymousResponse = responseDouble();
  await privateStatusHandler(request({ ip: "anonymous-test" }), anonymousResponse);
  assert.equal(anonymousResponse.statusCode, 401);

  const anonymousOperations = responseDouble();
  await operationsHandler(request({ ip: "anonymous-operations" }), anonymousOperations);
  assert.equal(anonymousOperations.statusCode, 401);

  const csrfResponse = responseDouble();
  await logoutHandler(request({ method: "POST", cookie, csrf: "wrong-csrf-token" }), csrfResponse);
  assert.equal(csrfResponse.statusCode, 401);

  const stillAuthenticated = responseDouble();
  await meHandler(request({ cookie }), stillAuthenticated);
  assert.equal(stillAuthenticated.statusCode, 200);

  const logoutResponse = responseDouble();
  await logoutHandler(request({ method: "POST", cookie, csrf: csrfToken }), logoutResponse);
  assert.equal(logoutResponse.statusCode, 200);
  assert.match(logoutResponse.headers["Set-Cookie"], /Max-Age=0/);

  const afterLogout = responseDouble();
  await meHandler(request({ cookie }), afterLogout);
  assert.equal(afterLogout.statusCode, 401);
  assert.equal(database.auditEvents.filter((event) => event.event_type === "auth.login.succeeded").length > 0, true);
  assert.equal(database.auditEvents.filter((event) => event.event_type === "auth.logout").length > 0, true);
});

test("login rate limiting returns 429 after configured failures", async () => {
  configureAuth({ AUTH_RATE_LIMIT_MAX_ATTEMPTS: "2", AUTH_RATE_LIMIT_WINDOW_SECONDS: "60" });
  clearAuthState();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = responseDouble();
    await loginHandler(request({ method: "POST", body: { username: "operator", password: "wrong password value" }, ip: "rate-limit-test" }), response);
    assert.equal(response.statusCode, 401);
  }
  const limited = responseDouble();
  await loginHandler(request({ method: "POST", body: { username: "operator", password }, ip: "rate-limit-test" }), limited);
  assert.equal(limited.statusCode, 429);
  assert.match(limited.headers["Retry-After"], /^\d+$/);
  configureAuth();
  clearAuthState();
});

test("state-changing auth routes reject cross-origin requests", async () => {
  const response = responseDouble();
  await loginHandler(request({ method: "POST", origin: "https://attacker.example", body: { username: "operator", password } }), response);
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.message, "Origin is not allowed");
});

test("database-backed sessions expire across simulated instances", async () => {
  const loginResponse = responseDouble();
  await loginHandler(request({ method: "POST", body: { username: "operator", password }, ip: "expiry-test" }), loginResponse);
  const cookie = cookieFrom(loginResponse);
  database.expireSessions();
  clearAuthState();
  const response = responseDouble();
  await meHandler(request({ cookie }), response);
  assert.equal(response.statusCode, 401);
});
