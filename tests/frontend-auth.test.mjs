import test from "node:test";
import assert from "node:assert/strict";
import { createAuthentication, AuthenticationError } from "../src/auth-client.js";

const publicConfig = { status: "ok", registrationEnabled: false, supabase: { url: "https://txdjozotaxpthpnfikqx.supabase.co", publishableKey: "sb_publishable_test" } };
const token = "mock-access-token";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function harness({ current = null, loginError = null, sessionError = null, config = publicConfig, configStatus = 200, api = () => json({ status: "ok", user: { username: "approved@example.test" } }) } = {}) {
  const calls = [];
  const events = [];
  let listener;
  const sdk = {
    auth: {
      async getSession() { calls.push(["getSession"]); return { data: { session: current }, error: sessionError }; },
      onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithPassword(credentials) { calls.push(["signInWithPassword", credentials]); if (!loginError) current = { access_token: token }; return { data: { session: current }, error: loginError }; },
      async signOut(options) { calls.push(["signOut", options]); current = null; listener?.("SIGNED_OUT"); return { error: null }; },
      async resetPasswordForEmail(email, options) { calls.push(["resetPasswordForEmail", email, options]); return { error: null }; },
      async updateUser(attributes) { calls.push(["updateUser", attributes]); return { error: null }; }
    }
  };
  const authentication = createAuthentication({
    createClient(...arguments_) { calls.push(["createClient", ...arguments_]); return sdk; },
    async fetchImpl(url, options) { calls.push(["fetch", url, options]); return url === "/api/auth/config" ? json(config, configStatus) : api(url, options); },
    onStateChange(event) { events.push(event); }
  });
  return { authentication, calls, events, emit(event) { listener(event); }, setSession(value) { current = value; } };
}

test("frontend initializes the official persistent, refreshing PKCE client from public configuration", async () => {
  const { authentication, calls } = harness();
  await authentication.initialize();
  const initialized = calls.find(([name]) => name === "createClient");
  assert.equal(initialized[1], publicConfig.supabase.url);
  assert.equal(initialized[2], publicConfig.supabase.publishableKey);
  assert.deepEqual(initialized[3], { auth: { persistSession: true, autoRefreshToken: true, flowType: "pkce", detectSessionInUrl: true } });
  const restored = await authentication.verifySession();
  assert.equal(restored.response.status, 401);
});

test("valid Supabase credentials require server authorization before frontend access", async () => {
  const { authentication, calls } = harness();
  await authentication.initialize();
  await authentication.signIn("approved@example.test", "existing-password");
  assert.deepEqual(calls.find(([name]) => name === "signInWithPassword")[1], { email: "approved@example.test", password: "existing-password" });
  const verified = calls.find(([name, url]) => name === "fetch" && url === "/api/auth/me");
  assert.equal(verified[2].headers.get("Authorization"), `Bearer ${token}`);
  assert.equal(verified[2].credentials, "omit");
});

test("invalid credentials and auth failures use safe authored errors", async () => {
  const { authentication } = harness({ loginError: { status: 400, message: "sensitive internal details" } });
  await authentication.initialize();
  await assert.rejects(authentication.signIn("invalid@example.test", "wrong"), (error) => error instanceof AuthenticationError && error.status === 401 && error.message === "Invalid email or password.");
});

test("invalid public keys and a disabled email provider show configuration errors", async () => {
  for (const loginError of [{ status: 401, message: "Invalid API key" }, { status: 400, code: "email_provider_disabled" }]) {
    const { authentication } = harness({ loginError });
    await authentication.initialize();
    await assert.rejects(authentication.signIn("approved@example.test", "existing-password"), (error) => error.status === 503 && /configuration is unavailable/.test(error.message));
  }
});

test("an authenticated Supabase account does not bypass server dashboard restrictions", async () => {
  const { authentication } = harness({ api: () => json({ message: "This account is not authorized for this workspace." }, 403) });
  await authentication.initialize();
  await assert.rejects(authentication.signIn("unapproved@example.test", "password"), (error) => error.status === 403);
});

test("restoration and protected requests obtain the current SDK refreshed token", async () => {
  const h = harness({ current: { access_token: "restored-token" } });
  await h.authentication.initialize();
  assert.equal((await h.authentication.verifySession()).response.status, 200);
  h.setSession({ access_token: "refreshed-token" });
  await h.authentication.request("/api/private/status");
  const request = h.calls.find(([name, url]) => name === "fetch" && url === "/api/private/status");
  assert.equal(request[2].headers.get("Authorization"), "Bearer refreshed-token");
});

test("missing sessions and rejected tokens keep protected requests inaccessible", async () => {
  const missing = harness();
  await missing.authentication.initialize();
  assert.equal((await missing.authentication.request("/api/private/status")).response.status, 401);
  assert.equal(missing.calls.some(([name, url]) => name === "fetch" && url === "/api/private/status"), false);
  const rejected = harness({ current: { access_token: "expired-token" }, api: () => json({ message: "Authentication required" }, 401) });
  await rejected.authentication.initialize();
  assert.equal((await rejected.authentication.request("/api/private/status")).response.status, 401);
  assert.deepEqual(rejected.events, ["SESSION_REJECTED"]);
});

test("failed session refresh fails safely without making a protected API request", async () => {
  const h = harness({ current: { access_token: token }, sessionError: { message: "private refresh details" } });
  await assert.rejects(h.authentication.initialize(), /authentication service is unavailable/);
  assert.equal(h.calls.some(([name, url]) => name === "fetch" && url.startsWith("/api/private/")), false);
});

test("successful logout revokes the server session before official browser cleanup", async () => {
  const h = harness({ current: { access_token: token } });
  await h.authentication.initialize();
  await h.authentication.signOut();
  const revokeIndex = h.calls.findIndex(([name, url]) => name === "fetch" && url === "/api/auth/logout");
  const cleanupIndex = h.calls.findIndex(([name]) => name === "signOut");
  assert.ok(revokeIndex < cleanupIndex);
  assert.deepEqual(h.calls[cleanupIndex][1], { scope: "local" });
  assert.equal((await h.authentication.request("/api/private/status")).response.status, 401);
});

test("logout outage preserves a retryable SDK session and never reports successful revocation", async () => {
  let unavailable = true;
  const h = harness({ current: { access_token: token }, api: () => json({}, unavailable ? 503 : 200) });
  await h.authentication.initialize();
  await assert.rejects(h.authentication.signOut(), /Sign-out could not be confirmed/);
  assert.equal(h.calls.some(([name]) => name === "signOut"), false);
  unavailable = false;
  await h.authentication.signOut();
  assert.equal(h.calls.filter(([name]) => name === "signOut").length, 1);
});

test("a late response from before sign-out cannot overwrite the newer signed-out state", async () => {
  let completePrivateRequest;
  const h = harness({ current: { access_token: token }, api: (url) => url === "/api/private/status" ? new Promise((resolve) => { completePrivateRequest = resolve; }) : json({ status: "ok" }) });
  await h.authentication.initialize();
  const pending = h.authentication.request("/api/private/status");
  await new Promise((resolve) => setImmediate(resolve));
  await h.authentication.signOut();
  completePrivateRequest(json({ message: "Authentication required" }, 401));
  const stale = await pending;
  assert.equal(stale.response.status, 409);
  assert.deepEqual(stale.data, {});
  assert.deepEqual(h.events, ["SIGNED_OUT"]);
});

test("recovery uses official email and password APIs and requires the SDK recovery event", async () => {
  const h = harness({ current: { access_token: token } });
  await h.authentication.initialize();
  await h.authentication.sendRecovery("approved@example.test", "https://dashboard.example.test");
  assert.deepEqual(h.calls.find(([name]) => name === "resetPasswordForEmail").slice(1), ["approved@example.test", { redirectTo: "https://dashboard.example.test/?recovery=1" }]);
  await assert.rejects(h.authentication.updatePassword("replacement-password"), (error) => error.status === 403);
  h.emit("PASSWORD_RECOVERY");
  assert.equal(h.authentication.isRecoveryActive(), true);
  await h.authentication.updatePassword("replacement-password");
  assert.deepEqual(h.calls.find(([name]) => name === "updateUser")[1], { password: "replacement-password" });
  assert.equal(h.authentication.isRecoveryActive(), false);
});

test("missing public configuration fails closed and does not construct a client", async () => {
  const h = harness({ config: { message: "Authentication is not configured" }, configStatus: 503 });
  await assert.rejects(h.authentication.initialize(), /not configured/);
  assert.equal(h.calls.some(([name]) => name === "createClient"), false);
});

test("bearer headers cannot be sent to external URLs or supplied by another caller", async () => {
  const h = harness({ current: { access_token: token } });
  await h.authentication.initialize();
  await assert.rejects(h.authentication.request("https://attacker.example/api/private/status"), /Invalid application request/);
  await assert.rejects(h.authentication.request("//attacker.example/api/private/status"), /Invalid application request/);
  await h.authentication.request("/api/private/status", { headers: { Authorization: "Bearer injected" } });
  const protectedRequest = h.calls.find(([name, url]) => name === "fetch" && url === "/api/private/status");
  assert.equal(protectedRequest[2].headers.get("Authorization"), `Bearer ${token}`);
  await h.authentication.request("/api/health", { headers: { Authorization: "Bearer injected" } });
  const publicRequest = h.calls.find(([name, url]) => name === "fetch" && url === "/api/health");
  assert.equal(publicRequest[2].headers.has("Authorization"), false);
});
