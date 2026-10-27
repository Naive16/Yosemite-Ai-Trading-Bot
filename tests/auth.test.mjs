import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, clearAuthState } from "../api/_lib/auth.js";
import { loadConfig, ConfigurationError } from "../api/_lib/config.js";
import { setSupabaseFetchForTests } from "../api/_lib/supabase.js";
import loginHandler from "../api/auth/login.js";
import meHandler from "../api/auth/me.js";
import logoutHandler from "../api/auth/logout.js";
import healthHandler from "../api/health.js";
import privateStatusHandler from "../api/private/status.js";
import operationsHandler from "../api/private/operations.js";
import marketDataHandler from "../api/private/market-data.js";
import strategyHandler from "../api/private/strategy.js";
import analysisHandler from "../api/private/analysis.js";
import riskHandler from "../api/private/risk.js";
import proposalsHandler from "../api/private/proposals.js";
import backtestHandler from "../api/private/backtest.js";
import paperHandler from "../api/private/paper.js";
import worker from "../src/worker.js";
import { setDatabaseForTests, clearDatabaseTestOverride } from "../api/_lib/database.js";
import { FakeDatabase } from "./support/fake-database.mjs";
import {
  TEST_INTRUDER_USER_ID,
  TEST_OWNER_EMAIL,
  TEST_OWNER_PASSWORD,
  TEST_SUPABASE_ANON_KEY,
  TEST_SUPABASE_ENV,
  TEST_SUPABASE_OWNER_ID,
  TEST_SUPABASE_URL,
  createFakeSupabaseFetch
} from "./support/fake-supabase.mjs";

const password = TEST_OWNER_PASSWORD;
const passwordHash = await hashPassword(password, { N: 1_024, r: 1, p: 1 });
const originalEnv = { ...process.env };
const database = new FakeDatabase();

function configureAuth(overrides = {}) {
  Object.assign(process.env, {
    APP_ENV: "test",
    APP_ORIGIN: "http://localhost:3000",
    TRADING_MODE: "disabled",
    LIVE_TRADING_ENABLED: "false",
    ...TEST_SUPABASE_ENV,
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

function installDefaultSupabaseMock() {
  setSupabaseFetchForTests(createFakeSupabaseFetch());
}

before(() => {
  database.reset();
  configureAuth();
  clearAuthState();
  installDefaultSupabaseMock();
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

test("password hashing helper verifies the password and rejects another password", async () => {
  assert.equal(await verifyPassword(password, passwordHash), true);
  assert.equal(await verifyPassword("not the configured password", passwordHash), false);
});

test("configuration enforces Supabase-only auth, rejects service-role keys, and rejects live trading", () => {
  assert.throws(() => loadConfig({ APP_ENV: "test", LIVE_TRADING_ENABLED: "true" }), ConfigurationError);
  assert.throws(() => loadConfig({ APP_ENV: "production", ...TEST_SUPABASE_ENV }), ConfigurationError);
  assert.throws(() => loadConfig({ APP_ENV: "test", SUPABASE_URL: TEST_SUPABASE_URL }), ConfigurationError);
  assert.throws(() => loadConfig({
    APP_ENV: "test",
    ...TEST_SUPABASE_ENV,
    SUPABASE_ANON_KEY: "sb_secret_never_use_secret_key_here",
    SESSION_SECRET: "a".repeat(32)
  }), /never a secret key/);

  const serviceRoleJwt = [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ role: "service_role", iss: "supabase" })).toString("base64url"),
    "signature_placeholder"
  ].join(".");
  assert.throws(() => loadConfig({
    APP_ENV: "test",
    ...TEST_SUPABASE_ENV,
    SUPABASE_ANON_KEY: serviceRoleJwt,
    SESSION_SECRET: "a".repeat(32)
  }), /service_role/);

  assert.throws(() => loadConfig({
    APP_ENV: "test",
    ...TEST_SUPABASE_ENV,
    SUPABASE_SERVICE_ROLE_KEY: "secret-service-role-key",
    SESSION_SECRET: "a".repeat(32)
  }), /service-role or secret keys must not be configured/);

  const config = loadConfig({
    APP_ENV: "production",
    APP_ORIGIN: "https://example.com",
    ...TEST_SUPABASE_ENV,
    SESSION_SECRET: "a".repeat(32),
    DATABASE_URL: "postgresql://user:secret@example.test/db"
  });
  assert.equal(config.appOrigin, "https://example.com");
  assert.equal(config.auth.provider, "supabase");
  assert.equal(config.auth.configured, true);
  assert.equal(config.liveTradingEnabled, false);
});

test("login validates input, rejects client-supplied user IDs, and does not leak credential details", async () => {
  installDefaultSupabaseMock();
  const shortPassword = responseDouble();
  await loginHandler(request({ method: "POST", body: { email: TEST_OWNER_EMAIL, password: "short" } }), shortPassword);
  assert.equal(shortPassword.statusCode, 400);
  assert.equal(shortPassword.body.message, "Password is invalid");

  const invalidEmail = responseDouble();
  await loginHandler(request({ method: "POST", body: { email: "not-an-email", password } }), invalidEmail);
  assert.equal(invalidEmail.statusCode, 400);
  assert.equal(invalidEmail.body.message, "Email is invalid");

  const injectedUserId = responseDouble();
  await loginHandler(request({
    method: "POST",
    body: { email: "intruder@example.test", password: "intruder-valid-password", userId: TEST_SUPABASE_OWNER_ID }
  }), injectedUserId);
  assert.equal(injectedUserId.statusCode, 400);
  assert.equal(injectedUserId.body.code, "spoofed_user_id_rejected");
  assert.equal(injectedUserId.body.message, "Client-supplied user identifiers are not allowed");

  const unexpectedField = responseDouble();
  await loginHandler(request({
    method: "POST",
    body: { email: TEST_OWNER_EMAIL, password, extra: "not-allowed" }
  }), unexpectedField);
  assert.equal(unexpectedField.statusCode, 400);
  assert.equal(unexpectedField.body.message, "Unexpected request field");

  const invalid = responseDouble();
  await loginHandler(request({ method: "POST", body: { email: TEST_OWNER_EMAIL, password: "wrong password value" }, ip: "invalid-test" }), invalid);
  assert.equal(invalid.statusCode, 401);
  assert.equal(invalid.body.message, "Invalid email or password");
  assert.equal(Object.hasOwn(invalid.body, "user"), false);
});

test("successful Supabase owner login creates an HttpOnly session and protected routes require it", async () => {
  const fakeFetch = createFakeSupabaseFetch();
  setSupabaseFetchForTests(fakeFetch);

  const loginResponse = responseDouble();
  await loginHandler(request({ method: "POST", body: { email: TEST_OWNER_EMAIL, password } }), loginResponse);
  assert.equal(loginResponse.statusCode, 200);
  assert.match(loginResponse.headers["Set-Cookie"], /HttpOnly/);
  assert.match(loginResponse.headers["Set-Cookie"], /SameSite=Lax/);
  assert.equal(loginResponse.headers["Cache-Control"], "no-store");
  assert.equal(fakeFetch.calls.some((call) => call.pathname === "/auth/v1/user"), true);
  assert.equal(fakeFetch.calls.some((call) => call.pathname === "/auth/v1/logout"), true);
  const cookie = cookieFrom(loginResponse);
  const csrfToken = loginResponse.body.csrfToken;

  // A new simulated serverless instance has no in-memory session state, but the shared Supabase PostgreSQL database still validates the session.
  clearAuthState();
  installDefaultSupabaseMock();

  const meResponse = responseDouble();
  await meHandler(request({ cookie }), meResponse);
  assert.equal(meResponse.statusCode, 200);
  assert.equal(meResponse.body.user.username, TEST_OWNER_EMAIL);

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

test("non-owner Supabase user is rejected with 403 even if token payload user ID was spoofed", async () => {
  const spoofedFetch = createFakeSupabaseFetch({
    accounts: [
      {
        id: TEST_INTRUDER_USER_ID,
        tokenUserIdOverride: TEST_SUPABASE_OWNER_ID,
        email: "intruder@example.test",
        password: "intruder-valid-password",
        email_confirmed_at: "2026-10-20T00:00:00.000Z"
      }
    ]
  });
  setSupabaseFetchForTests(spoofedFetch);

  const denied = responseDouble();
  await loginHandler(request({
    method: "POST",
    body: { email: "intruder@example.test", password: "intruder-valid-password" },
    ip: "intruder-ip"
  }), denied);

  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.code, "access_denied");
  assert.equal(denied.headers["Set-Cookie"], undefined);
  assert.equal([...database.users.values()].some((row) => row.id === TEST_INTRUDER_USER_ID), false);
  assert.equal(database.auditEvents.some((event) => event.event_type === "auth.access.denied"), true);
  installDefaultSupabaseMock();
});

test("unconfirmed Supabase email is rejected and upstream outages fail closed with 503 without leaking secrets", async () => {
  setSupabaseFetchForTests(createFakeSupabaseFetch({
    accounts: [
      {
        id: TEST_SUPABASE_OWNER_ID,
        email: TEST_OWNER_EMAIL,
        password,
        email_confirmed_at: null
      }
    ]
  }));
  const unconfirmed = responseDouble();
  await loginHandler(request({ method: "POST", body: { email: TEST_OWNER_EMAIL, password }, ip: "unconfirmed-ip" }), unconfirmed);
  assert.equal(unconfirmed.statusCode, 401);

  setSupabaseFetchForTests(async () => {
    throw new TypeError("fetch failed");
  });
  const outage = responseDouble();
  await loginHandler(request({ method: "POST", body: { email: TEST_OWNER_EMAIL, password }, ip: "outage-ip" }), outage);
  assert.equal(outage.statusCode, 503);
  assert.equal(JSON.stringify(outage.body).includes(TEST_SUPABASE_ANON_KEY), false);
  assert.equal(JSON.stringify(outage.body).includes(TEST_SUPABASE_OWNER_ID), false);
  installDefaultSupabaseMock();
});

test("owner user resolution preserves pre-existing app_users rows and handles username collisions without overwriting", async () => {
  database.reset();
  database.users.set(TEST_OWNER_EMAIL, {
    id: "22222222-3333-4444-8555-666666666666",
    username: TEST_OWNER_EMAIL,
    password_hash: "legacy-row-must-not-be-overwritten-12345"
  });
  installDefaultSupabaseMock();

  const loginResponse = responseDouble();
  await loginHandler(request({ method: "POST", body: { email: TEST_OWNER_EMAIL, password }, ip: "collision-ip" }), loginResponse);
  assert.equal(loginResponse.statusCode, 200);
  assert.equal(loginResponse.body.user.username, `supabase:${TEST_SUPABASE_OWNER_ID}`);
  assert.equal(database.users.get(TEST_OWNER_EMAIL).id, "22222222-3333-4444-8555-666666666666");

  const callsBeforeSecondLogin = database.calls.filter((call) => call.text.includes("INSERT INTO app_users")).length;
  const secondLogin = responseDouble();
  await loginHandler(request({ method: "POST", body: { email: TEST_OWNER_EMAIL, password }, ip: "second-login-ip" }), secondLogin);
  assert.equal(secondLogin.statusCode, 200);
  const callsAfterSecondLogin = database.calls.filter((call) => call.text.includes("INSERT INTO app_users")).length;
  assert.equal(callsAfterSecondLogin, callsBeforeSecondLogin);
});

test("login rate limiting returns 429 after configured failures", async () => {
  configureAuth({ AUTH_RATE_LIMIT_MAX_ATTEMPTS: "2", AUTH_RATE_LIMIT_WINDOW_SECONDS: "60" });
  clearAuthState();
  installDefaultSupabaseMock();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = responseDouble();
    await loginHandler(request({ method: "POST", body: { email: TEST_OWNER_EMAIL, password: "wrong password value" }, ip: "rate-limit-test" }), response);
    assert.equal(response.statusCode, 401);
  }
  const limited = responseDouble();
  await loginHandler(request({ method: "POST", body: { email: TEST_OWNER_EMAIL, password }, ip: "rate-limit-test" }), limited);
  assert.equal(limited.statusCode, 429);
  assert.match(limited.headers["Retry-After"], /^\d+$/);
  configureAuth();
  clearAuthState();
  installDefaultSupabaseMock();
});

test("state-changing auth routes reject cross-origin requests", async () => {
  const response = responseDouble();
  await loginHandler(request({ method: "POST", origin: "https://attacker.example", body: { email: TEST_OWNER_EMAIL, password } }), response);
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.message, "Origin is not allowed");
});

test("database-backed sessions expire across simulated instances", async () => {
  const loginResponse = responseDouble();
  await loginHandler(request({ method: "POST", body: { email: TEST_OWNER_EMAIL, password }, ip: "expiry-test" }), loginResponse);
  const cookie = cookieFrom(loginResponse);
  database.expireSessions();
  clearAuthState();
  installDefaultSupabaseMock();
  const response = responseDouble();
  await meHandler(request({ cookie }), response);
  assert.equal(response.statusCode, 401);
});

test("concurrent and repeated owner logins map to exactly one app_users record without duplicates", async () => {
  database.reset();
  configureAuth();
  clearAuthState();
  installDefaultSupabaseMock();

  const responses = await Promise.all(
    Array.from({ length: 5 }, (_, index) => {
      const res = responseDouble();
      return loginHandler(request({ method: "POST", body: { email: TEST_OWNER_EMAIL, password }, ip: `concurrent-${index}` }), res).then(() => res);
    })
  );

  for (const res of responses) {
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["Set-Cookie"], /^yosemite_session=/);
  }
  assert.equal(database.users.size, 1);
  const [ownerRecord] = [...database.users.values()];
  assert.equal(ownerRecord.id, TEST_SUPABASE_OWNER_ID);
  assert.equal(ownerRecord.username, TEST_OWNER_EMAIL);
});

test("every protected route enforces SUPABASE_OWNER_USER_ID (403) and rejects spoofed user IDs (400)", async () => {
  database.reset();
  configureAuth();
  clearAuthState();
  installDefaultSupabaseMock();

  const loginResponse = responseDouble();
  await loginHandler(request({ method: "POST", body: { email: TEST_OWNER_EMAIL, password }, ip: "owner-route-test" }), loginResponse);
  const cookie = cookieFrom(loginResponse);
  const csrf = loginResponse.body.csrfToken;

  // Spoofed user ID via header or query parameter is rejected across protected routes even with a valid cookie.
  const spoofedHeaderRes = responseDouble();
  await privateStatusHandler({
    method: "GET",
    url: "/api/private/status",
    headers: { origin: "http://localhost:3000", cookie, "x-user-id": TEST_INTRUDER_USER_ID }
  }, spoofedHeaderRes);
  assert.equal(spoofedHeaderRes.statusCode, 400);
  assert.equal(spoofedHeaderRes.body.code, "spoofed_user_id_rejected");

  const spoofedQueryRes = responseDouble();
  await meHandler({
    method: "GET",
    url: `/api/auth/me?userId=${TEST_INTRUDER_USER_ID}`,
    headers: { origin: "http://localhost:3000", cookie }
  }, spoofedQueryRes);
  assert.equal(spoofedQueryRes.statusCode, 400);
  assert.equal(spoofedQueryRes.body.code, "spoofed_user_id_rejected");

  // Rotate SUPABASE_OWNER_USER_ID so the previously minted session no longer belongs to the configured owner:
  // every single protected endpoint must enforce owner authorization server-side and return 403 Forbidden.
  configureAuth({ SUPABASE_OWNER_USER_ID: "33333333-4444-4555-8666-777777777777" });

  const protectedChecks = [
    [meHandler, "GET", "/api/auth/me"],
    [logoutHandler, "POST", "/api/auth/logout"],
    [privateStatusHandler, "GET", "/api/private/status"],
    [operationsHandler, "GET", "/api/private/operations"],
    [marketDataHandler, "GET", "/api/private/market-data?kind=quote&symbol=EUR%2FUSD"],
    [strategyHandler, "GET", "/api/private/strategy?symbol=EUR%2FUSD&timeframe=M15"],
    [analysisHandler, "GET", "/api/private/analysis?symbol=EUR%2FUSD&timeframe=M15"],
    [riskHandler, "GET", "/api/private/risk"],
    [proposalsHandler, "GET", "/api/private/proposals"],
    [proposalsHandler, "POST", "/api/private/proposals"],
    [backtestHandler, "GET", "/api/private/backtest"],
    [backtestHandler, "POST", "/api/private/backtest"],
    [paperHandler, "GET", "/api/private/paper"],
    [paperHandler, "POST", "/api/private/paper"]
  ];

  for (const [handlerFn, method, url] of protectedChecks) {
    const res = responseDouble();
    await handlerFn({
      method,
      url,
      headers: {
        origin: "http://localhost:3000",
        cookie,
        ...(method === "POST" ? { "content-type": "application/json", "x-csrf-token": csrf } : {})
      },
      ...(method === "POST" ? { body: "{}" } : {})
    }, res);
    assert.equal(res.statusCode, 403, `Expected 403 on ${method} ${url}, received ${res.statusCode}`);
    assert.equal(res.body.code, "access_denied");
  }

  configureAuth();
  installDefaultSupabaseMock();
});

test("public sign-up endpoints are disabled and missing auth config keeps /api/health operational without leaking secrets", async () => {
  const workerEnv = {
    APP_ENV: "production",
    APP_ORIGIN: "https://yosemite-ai-trading-bot.francismkanda01.workers.dev",
    TRADING_MODE: "disabled",
    LIVE_TRADING_ENABLED: "false",
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }
  };

  for (const path of ["/api/auth/signup", "/api/auth/register"]) {
    const signupRes = await worker.fetch(new Request(`https://yosemite-ai-trading-bot.francismkanda01.workers.dev${path}`, { method: "POST", body: "{}" }), workerEnv);
    assert.equal(signupRes.status, 404);
  }

  const healthRes = responseDouble();
  await healthHandler({ method: "GET", runtimeEnv: workerEnv }, healthRes);
  assert.equal(healthRes.statusCode, 200);
  assert.equal(healthRes.body.tradingEnabled, false);

  const unconfiguredLogin = responseDouble();
  await loginHandler({
    method: "POST",
    runtimeEnv: { ...workerEnv, SESSION_SECRET: "super-secret-value-that-must-never-leak-1234" },
    headers: { origin: "https://yosemite-ai-trading-bot.francismkanda01.workers.dev", "content-type": "application/json" },
    body: JSON.stringify({ email: TEST_OWNER_EMAIL, password })
  }, unconfiguredLogin);
  assert.equal(unconfiguredLogin.statusCode, 503);
  assert.equal(JSON.stringify(unconfiguredLogin.body).includes("super-secret-value"), false);
});

