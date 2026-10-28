import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { chromium } from "playwright-core";
import { createServer } from "../server.js";

// All Auth and application API calls are intercepted. This test cannot contact
// Supabase, a database, a market-data provider, or a broker.
let browser;
let server;
let origin;
const projectUrl = "https://txdjozotaxpthpnfikqx.supabase.co";
const email = "approved@example.test";
const password = "mock-password-only";
const authUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function session() {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: authUserId, aud: "authenticated", role: "authenticated", iss: projectUrl + "/auth/v1", iat: now, exp: now + 3600, session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })}.bW9ja2VkLXNpZ25hdHVyZQ`, refresh_token: "mock-refresh-token", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user: { id: authUserId, email, aud: "authenticated", role: "authenticated", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, created_at: new Date().toISOString() } };
}

before(async () => {
  const candidates = [process.env.BROWSER_EXECUTABLE, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].filter(Boolean);
  let executablePath;
  for (const candidate of candidates) { try { await access(candidate); executablePath = candidate; break; } catch {} }
  if (!executablePath) throw new Error("No browser found. Set BROWSER_EXECUTABLE to an installed Chrome, Edge, or Chromium executable.");
  browser = await chromium.launch({ executablePath, headless: true });
  server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await browser?.close(); if (server) await new Promise((resolve) => server.close(resolve)); });

async function fixture() {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const state = { revoked: false, logoutFailure: false, unauthorized: false, privateFailure: false, databaseFailure: false, networkFailure: false, privateDelay: 0, recoveries: 0, updates: 0, authRequests: 0, unexpectedNetwork: [], errors: [] };
  page.on("pageerror", (error) => state.errors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const send = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body), headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version", "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS" } });
    if (url.origin === projectUrl) {
      state.authRequests += 1;
      if (request.method() === "OPTIONS") return send({});
      if (url.pathname.endsWith("/token")) {
        if (url.searchParams.get("grant_type") === "password") {
          const credentials = request.postDataJSON();
          if (credentials.email !== email || credentials.password !== password) return send({ error_code: "invalid_credentials", msg: "Invalid login credentials" }, 400);
        }
        state.revoked = false;
        return send(session());
      }
      if (url.pathname.endsWith("/logout")) return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": origin } });
      if (url.pathname.endsWith("/recover")) { state.recoveries += 1; return send({}); }
      if (url.pathname.endsWith("/user")) { if (request.method() === "PUT") state.updates += 1; return send(session().user); }
      state.unexpectedNetwork.push("unexpected Auth endpoint");
      return route.abort();
    }
    if (url.origin !== origin) { state.unexpectedNetwork.push("external request blocked"); return route.abort(); }
    if (url.pathname === "/api/auth/config") return send({ status: "ok", registrationEnabled: false, supabase: { url: projectUrl, publishableKey: "sb_publishable_mock_for_browser_test" } });
    if (url.pathname === "/api/auth/logout") { if (state.logoutFailure) return send({ message: "Authentication unavailable" }, 503); state.revoked = true; return send({ status: "ok" }); }
    if (url.pathname === "/api/auth/me") {
      if (!request.headers().authorization || state.revoked) return send({ message: "Authentication required" }, 401);
      if (state.unauthorized) return send({ message: "This account is not authorized for this workspace." }, 403);
      return send({ status: "ok", user: { username: email }, expiresAt: new Date(Date.now() + 3600000).toISOString() });
    }
    if (url.pathname === "/api/health") return send({ status: "ok", services: {} });
    if (url.pathname.startsWith("/api/private/")) {
      if (state.privateDelay) await new Promise((resolve) => setTimeout(resolve, state.privateDelay));
      if (state.networkFailure) return route.abort();
      if (state.privateFailure || state.revoked || !request.headers().authorization) return send({ message: "Authentication required" }, 401);
      if (state.databaseFailure) return send({ message: "Database unavailable" }, 503);
      if (url.pathname.endsWith("/status")) return send({ status: "ok", tradingEnabled: false });
      if (url.pathname.endsWith("/operations")) return send({ services: {} });
      if (url.pathname.endsWith("/risk")) return send({ evaluation: { decision: "BLOCKED" } });
      if (url.pathname.endsWith("/proposals")) return send({ proposals: [] });
      return send({ message: "Unavailable in isolated auth test" }, 503);
    }
    return route.continue();
  });
  const login = async (loginPassword = password) => {
    await page.locator("#login-submit").waitFor({ state: "visible" });
    await page.waitForFunction(() => !document.querySelector("#login-submit").disabled);
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(loginPassword);
    await page.locator("#login-submit").click({ force: true });
  };
  const clean = async () => { assert.deepEqual(state.unexpectedNetwork, []); assert.deepEqual(state.errors, []); await context.close(); };
  await page.goto(origin);
  return { context, page, state, login, clean };
}

test("browser: invalid credentials, valid login, refresh restoration, logout, and signed-out refresh", async () => {
  const f = await fixture();
  try {
    await f.login("wrong-password");
    await f.page.locator("#login-message").filter({ hasText: "Invalid email or password" }).waitFor();
    assert.equal(await f.page.locator("#app-shell").isHidden(), true);
    await f.login();
    await f.page.locator("#app-shell").waitFor({ state: "visible" });
    f.state.privateDelay = 250;
    await f.page.reload();
    await f.page.locator("#app-shell").waitFor({ state: "visible" });
    await f.page.locator("#logout-button").click({ force: true });
    await f.page.locator("#login-message").filter({ hasText: "You have been signed out" }).waitFor();
    await f.page.waitForLoadState("networkidle");
    assert.match(await f.page.locator("#login-message").innerText(), /You have been signed out/);
    assert.equal(f.state.revoked, true);
    await f.page.reload();
    await f.page.waitForFunction(() => !document.querySelector("#login-submit").disabled);
    assert.equal(await f.page.locator("#app-shell").isHidden(), true);
  } finally { await f.clean(); }
});

test("browser: unauthorized accounts and expired API sessions hide protected views", async () => {
  const f = await fixture();
  try {
    f.state.unauthorized = true;
    await f.login();
    await f.page.locator("#login-message").filter({ hasText: "not authorized" }).waitFor();
    assert.equal(await f.page.locator("#app-shell").isHidden(), true);
    f.state.unauthorized = false;
    await f.login();
    await f.page.locator("#app-shell").waitFor({ state: "visible" });
    await f.page.waitForLoadState("networkidle");
    f.state.privateFailure = true;
    await f.page.locator("[data-view=health]").click({ force: true });
    await f.page.locator("#refresh-health").click({ force: true });
    await f.page.locator("#login-screen").waitFor({ state: "visible" });
    assert.equal(await f.page.locator("#app-shell").isHidden(), true);
  } finally { await f.clean(); }
});

test("browser: logout outage hides private data and offers a truthful working retry", async () => {
  const f = await fixture();
  try {
    await f.login();
    await f.page.locator("#app-shell").waitFor({ state: "visible" });
    f.state.logoutFailure = true;
    await f.page.locator("#logout-button").click({ force: true });
    await f.page.locator("#retry-signout-button").waitFor({ state: "visible" });
    assert.equal(await f.page.locator("#app-shell").isHidden(), true);
    assert.match(await f.page.locator("#login-message").innerText(), /could not be confirmed/);
    f.state.logoutFailure = false;
    await f.page.locator("#retry-signout-button").click({ force: true });
    await f.page.locator("#login-message").filter({ hasText: "You have been signed out" }).waitFor();
    assert.equal(f.state.revoked, true);
  } finally { await f.clean(); }
});

test("browser: official PKCE recovery callback opens password form and signs out after update", async () => {
  const f = await fixture();
  try {
    await f.page.waitForFunction(() => !document.querySelector("#reset-password-button").disabled);
    await f.page.locator("#email").fill(email);
    await f.page.locator("#reset-password-button").click({ force: true });
    await f.page.locator("#login-message").filter({ hasText: "recovery link will be sent" }).waitFor();
    assert.equal(f.state.recoveries, 1);
    await f.page.goto(`${origin}/?code=mock-recovery-code&recovery=1`);
    await f.page.locator("#recovery-form").waitFor({ state: "visible" });
    assert.equal(await f.page.locator("#app-shell").isHidden(), true);
    await f.page.locator("#recovery-password").fill("mock-new-password-only");
    await f.page.locator("#recovery-submit").click({ force: true });
    await f.page.locator("#login-message").filter({ hasText: "Password updated" }).waitFor();
    assert.equal(f.state.updates, 1);
    assert.equal(f.state.revoked, true);
  } finally { await f.clean(); }
});

test("browser: database outages remain service errors without falsely signing the user out", async () => {
  const f = await fixture();
  try {
    await f.login();
    await f.page.locator("#app-shell").waitFor({ state: "visible" });
    await f.page.waitForLoadState("networkidle");
    f.state.databaseFailure = true;
    await f.page.locator("[data-view=health]").click({ force: true });
    await f.page.locator("#refresh-health").click({ force: true });
    await f.page.locator("#connection-status").filter({ hasText: "Database unavailable" }).waitFor();
    assert.equal(await f.page.locator("#app-shell").isVisible(), true);
    assert.equal(await f.page.locator("#login-screen").isHidden(), true);
  } finally { await f.clean(); }
});

test("browser: network failures produce service states without unhandled promises or false logout", async () => {
  const f = await fixture();
  try {
    f.state.networkFailure = true;
    await f.login();
    await f.page.locator("#app-shell").waitFor({ state: "visible" });
    await f.page.locator("#connection-status").filter({ hasText: "requested service is unavailable" }).waitFor();
    await f.page.waitForLoadState("networkidle");
    assert.equal(await f.page.locator("#app-shell").isVisible(), true);
    assert.equal(await f.page.locator("#login-screen").isHidden(), true);
  } finally { await f.clean(); }
});
