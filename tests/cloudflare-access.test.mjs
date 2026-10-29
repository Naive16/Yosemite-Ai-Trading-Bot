import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { loadConfig } from "../api/_lib/config.js";
import {
  clearAuthState, clearCloudflareJwksCacheForTests, csrfMatches, getSession,
  verifyCloudflareAssertion
} from "../api/_lib/auth.js";
import { createDatabaseClient, DatabaseConfigurationError, setDatabaseForTests, clearDatabaseTestOverride } from "../api/_lib/database.js";
import { FakeDatabase } from "./support/fake-database.mjs";
import statusHandler from "../api/private/status.js";
import { routes } from "../api/_lib/routes.js";

const JWKS_URL = "https://test-team.cloudflareaccess.com/.well-known/jwks";
const CF_AUDIENCE = "yosemite-dashboard";
const SERVICE_ROLE_KEY = "sb_secret_test-service-role-000000000000000000000000";

const originalEnv = { ...process.env };
let database;
let privateKey;
let jwks;

function base64url(value) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }

// One stable RSA key pair for the whole file keeps the JWKS cache valid across tests.
const keyPair = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
privateKey = createPrivateKey(keyPair.privateKey);
const publicJwk = createPublicKey(keyPair.publicKey).export({ type: "spki", format: "jwk" });
jwks = { keys: [{ ...publicJwk, kty: "RSA", kid: "cf-test-1", use: "sig", alg: "RS256" }] };

function makeCloudflareAssertion(signingKey, payloadOverrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: "cf-test-1" };
  const payload = {
    iss: `https://${new URL(JWKS_URL).hostname}`,
    sub: "auth0|cf-test-user",
    aud: CF_AUDIENCE,
    email: "operator@example.test",
    iat: now,
    exp: now + 3600,
    ...payloadOverrides
  };
  const signingInput = `${base64url(header)}.${base64url(payload)}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), signingKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

const responseDouble = () => ({
  statusCode: null, headers: {}, body: null,
  status(code) { this.statusCode = code; return this; },
  setHeader(name, value) { this.headers[name] = value; },
  json(body) { this.body = body; return this; }
});
const request = ({ method = "GET", token = "", assertion = "", origin = "http://localhost:3000", body, ...rest } = {}) => {
  const headers = { origin, ...(token ? { authorization: "Bearer " + token } : {}), ...rest.headers };
  if (assertion) headers["cf-access-jwt-assertion"] = assertion;
  if (body) headers["content-type"] = "application/json";
  return { method, headers, body, ...rest };
};
async function invoke(handler, req) { const res = responseDouble(); await handler(req, res); return res; }

beforeEach(async () => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv, {
    APP_ENV: "test", APP_ORIGIN: "http://localhost:3000", TRADING_MODE: "disabled", LIVE_TRADING_ENABLED: "false",
    WORKER_ENABLED: "false", MT5_EXECUTION_ENABLED: "false",
    SUPABASE_URL: "https://txdjozotaxpthpnfikqx.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-only",
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    CLOUDFLARE_ACCESS_JWKS_URL: JWKS_URL,
    CLOUDFLARE_ACCESS_AUDIENCE: CF_AUDIENCE
  });
  clearCloudflareJwksCacheForTests();
  globalThis.fetch = async (url) => new Response(JSON.stringify(jwks), {
    headers: { "content-type": "application/json" }, status: 200
  });
  database = new FakeDatabase();
  database.records.set("app_users", [{ id: "app-user-1", username: "operator@example.test" }]);
  setDatabaseForTests(database);
});
after(() => {
  globalThis.fetch = undefined;
  clearAuthState();
  clearDatabaseTestOverride();
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

test("missing Cloudflare assertion and missing credentials are rejected 401", async () => {
  for (const [route, handler] of routes.filter(([key]) => key.startsWith("GET /api/private/"))) {
    const response = await invoke(handler, request({ url: route.slice(4) }));
    assert.equal(response.statusCode, 401, route);
  }
});

test("malformed Cloudflare assertion is rejected 401", async () => {
  for (const garbage of ["not-a-jwt", "a.b", "a.b.c.d", "!!!"]) {
    const response = await invoke(statusHandler, request({ assertion: garbage }));
    assert.equal(response.statusCode, 401, garbage);
    assert.equal(response.body.code, "invalid_cloudflare_assertion", garbage);
  }
});

test("expired Cloudflare assertion is rejected 401", async () => {
  const assertion = makeCloudflareAssertion(privateKey, { exp: Math.floor(Date.now() / 1000) - 100 });
  const response = await invoke(statusHandler, request({ assertion }));
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, "invalid_cloudflare_assertion");
});

test("assertion signed with an untrusted key is rejected 401", async () => {
  const wrongKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const assertion = makeCloudflareAssertion(wrongKey);
  const response = await invoke(statusHandler, request({ assertion }));
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, "invalid_cloudflare_assertion");
});

test("untrusted issuer is rejected 401", async () => {
  const assertion = makeCloudflareAssertion(privateKey, { iss: "https://evil.example" });
  const response = await invoke(statusHandler, request({ assertion }));
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, "invalid_cloudflare_assertion");
});

test("untrusted audience is rejected 401", async () => {
  const assertion = makeCloudflareAssertion(privateKey, { aud: "other-audience" });
  const response = await invoke(statusHandler, request({ assertion }));
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, "invalid_cloudflare_assertion");
});

test("authorized Cloudflare identity reaches the protected dashboard", async () => {
  const assertion = makeCloudflareAssertion(privateKey);
  const response = await invoke(statusHandler, request({ assertion }));
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "ok");
  assert.equal(response.body.user.username, "operator@example.test");
  assert.equal(response.body.tradingEnabled, false);
  assert.equal(response.body.liveTradingEnabled, false);
});

test("Cloudflare identity with no matching app_users row is denied 403", async () => {
  database.records.set("app_users", []);
  const assertion = makeCloudflareAssertion(privateKey, { email: "stranger@example.test" });
  const response = await invoke(statusHandler, request({ assertion }));
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, "dashboard_access_denied");
});

test("missing service-role key means no admin client and authorizeAdmin fails closed", () => {
  const config = loadConfig({ ...process.env, SUPABASE_SERVICE_ROLE_KEY: "" });
  const db = createDatabaseClient({ supabase: config.supabase });
  assert.equal(db.adminClient, null);
  assert.throws(() => db.authorizeAdmin(), DatabaseConfigurationError);
});

test("getSession resolves a Cloudflare session and switches the database client", async () => {
  const assertion = makeCloudflareAssertion(privateKey);
  const session = await getSession(request({ assertion }), database, loadConfig(process.env));
  assert.equal(session.source, "cloudflare");
  assert.equal(session.userId, "app-user-1");
  assert.equal(session.authUserId, null);
  assert.equal(session.email, "operator@example.test");
  assert.equal(session.username, "operator@example.test");
  assert.equal(session.token, null);
  assert.equal(session.authenticated, true);
  assert.equal(database.adminAuthorized, true, "database must be switched to the service-role client");
});

test("getSession returns null when no credentials are present", async () => {
  const session = await getSession(request({}), database, loadConfig(process.env));
  assert.equal(session, null);
});

test("csrfMatches allows Cloudflare sessions but requires bearer proof otherwise", () => {
  const cloudflareSession = { source: "cloudflare", userId: "app-user-1" };
  assert.equal(csrfMatches(request({ assertion: makeCloudflareAssertion(privateKey) }), cloudflareSession), true);
  const bearerSession = { source: "supabase", token: "abc.def.ghi", userId: "u-1" };
  assert.equal(csrfMatches(request({ token: "abc.def.ghi" }), bearerSession), true);
  assert.equal(csrfMatches(request({ token: "wrong" }), bearerSession), false);
  assert.equal(csrfMatches(request({}), bearerSession), false);
});
