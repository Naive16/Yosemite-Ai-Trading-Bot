import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Isolated local Workerd only: synthetic public key, no remote bindings, no
// sign-in or database calls. Never load the user's environment files.
// Verifies the dashboard loads directly without an authentication screen and
// that protected endpoints stay private without a session.
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = resolve(root, ".local-data", "worker-smoke");
await mkdir(directory, { recursive: true });
const listener = createServer();
await new Promise((done) => listener.listen(0, "127.0.0.1", done));
const port = listener.address().port;
await new Promise((done) => listener.close(done));
const origin = `http://127.0.0.1:${port}`;
const config = resolve(directory, "wrangler.json");
await writeFile(config, JSON.stringify({
  name: "yosemite-local-dashboard-smoke", main: resolve(root, "src/worker.js"),
  compatibility_date: "2026-10-22", compatibility_flags: ["nodejs_compat"],
  assets: { directory: resolve(root, "src"), binding: "ASSETS", run_worker_first: ["/api/*"] },
  vars: { APP_ENV: "test", APP_ORIGIN: origin, SUPABASE_URL: "https://txdjozotaxpthpnfikqx.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_mock_only", TRADING_MODE: "disabled", LIVE_TRADING_ENABLED: "false", WORKER_ENABLED: "false", MT5_EXECUTION_ENABLED: "false", MT5_DEMO_MODE: "false", MT5_CONNECTOR: "none" }
}));
const worker = spawn(process.execPath, [resolve(root, "node_modules/wrangler/bin/wrangler.js"), "dev", "--local", "--config", config, "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0", "--log-level", "error"], {
  cwd: directory, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false", WRANGLER_SEND_METRICS: "false" }
});
let exited = false;
worker.on("exit", () => { exited = true; });
let output = "";
for (const stream of [worker.stdout, worker.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-16_384); });
async function get(path) { return fetch(origin + path, { signal: AbortSignal.timeout(3_000) }); }
try {
  let ready = false;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline && !exited) {
    try { if ((await get("/api/health")).status === 200) { ready = true; break; } } catch {}
    await new Promise((done) => setTimeout(done, 250));
  }
  if (!ready) {
    const safeOutput = output.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted database URL]").replace(/eyJ[A-Za-z0-9_.-]+/g, "[redacted token]").replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[redacted key]");
    throw new Error("Local Worker failed to become ready: " + safeOutput);
  }
  // The dashboard is the default landing page: no login screen, shell visible by default.
  const index = await get("/");
  assert.equal(index.status, 200);
  const body = await index.text();
  assert.doesNotMatch(body, /login-screen|login-submit|sign-out-button|recovery-form/);
  assert.match(body, /id="app-shell"/);
  assert.doesNotMatch(body, /id="app-shell" hidden/);
  assert.match(body, /Live trading disabled/);
  assert.match(index.headers.get("content-security-policy") || "", /default-src 'self'/);
  // Protected endpoints reject anonymous requests; public config stays available.
  assert.equal((await get("/api/auth/config")).status, 200);
  for (const path of ["/api/auth/me", "/api/private/status", "/api/private/operations", "/api/private/proposals"]) {
    assert.equal((await get(path)).status, 401, path);
  }
  assert.equal((await get("/auth-client.js")).status, 404);
  assert.equal((await get("/worker.js")).status, 404);
  const health = await (await get("/api/health")).json();
  assert.equal(health.tradingEnabled, false);
  assert.equal(health.liveTradingEnabled, false);

  const projectUrl = "https://txdjozotaxpthpnfikqx.supabase.co";
  async function fixture() {
    const { chromium } = await import("playwright-core");
    const candidates = [process.env.BROWSER_EXECUTABLE, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].filter(Boolean);
    let executablePath;
    for (const candidate of candidates) { try { await access(candidate); executablePath = candidate; break; } catch {} }
    if (!executablePath) throw new Error("No browser found. Set BROWSER_EXECUTABLE to an installed Chrome, Edge, or Chromium executable.");
    const browser = await chromium.launch({ executablePath, headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const state = { errors: [], unexpectedNetwork: [] };
    page.on("pageerror", (error) => state.errors.push(error.message));
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const send = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body), headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version", "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS" } });
      if (url.origin === projectUrl) { state.unexpectedNetwork.push("external supabase request blocked"); return route.abort(); }
      if (url.origin !== origin) { state.unexpectedNetwork.push("external request blocked"); return route.abort(); }
      if (url.pathname === "/api/auth/config") return send({ status: "ok", registrationEnabled: false, supabase: { url: projectUrl, publishableKey: "sb_publishable_mock_for_browser_test" } });
      if (url.pathname === "/api/auth/logout") return send({ status: "ok" });
      if (url.pathname === "/api/auth/me") return send({ message: "Authentication required" }, 401);
      if (url.pathname === "/api/health") return send({ status: "ok", services: {} });
      if (url.pathname.startsWith("/api/private/")) {
        if (!request.headers().authorization) return send({ message: "Authentication required" }, 401);
        if (url.pathname.endsWith("/status")) return send({ status: "ok", tradingEnabled: false });
        if (url.pathname.endsWith("/operations")) return send({ services: {} });
        if (url.pathname.endsWith("/risk")) return send({ evaluation: { decision: "BLOCKED" } });
        if (url.pathname.endsWith("/proposals")) return send({ proposals: [] });
        return send({ message: "Unavailable in isolated dashboard test" }, 503);
      }
      return route.continue();
    });
    await page.goto(origin);
    await page.waitForLoadState("networkidle");
    return {
      context, page, browser, state,
      clean: async () => { assert.deepEqual(state.unexpectedNetwork, []); assert.deepEqual(state.errors, []); await context.close(); await browser.close(); }
    };
  }

  test("browser: dashboard loads directly on open and refresh without an authentication screen", async () => {
    let f;
    try {
      f = await fixture();
      assert.equal(await f.page.locator("#login-screen").count(), 0);
      assert.equal(await f.page.locator("#login-submit").count(), 0);
      assert.equal(await f.page.locator("#logout-button").count(), 0);
      assert.equal(await f.page.locator("#app-shell").isVisible(), true);
      assert.match(await f.page.locator("#app-shell").textContent(), /Control room|Overview/);
      await f.page.reload();
      await f.page.waitForLoadState("networkidle");
      assert.equal(await f.page.locator("#login-screen").count(), 0);
      assert.equal(await f.page.locator("#app-shell").isVisible(), true);
    } finally { if (f) await f.clean().catch(() => {}); }
  });

  test("browser: dashboard shows honest service states without a session", async () => {
    let f;
    try {
      f = await fixture();
      assert.equal(await f.page.locator("#app-shell").isVisible(), true);
      assert.equal(await f.page.locator("#login-screen").count(), 0);
      assert.equal(await f.page.locator("#connection-status").count(), 1);
    } finally { if (f) await f.clean().catch(() => {}); }
  });
} finally {
  if (process.platform === "win32" && !exited) spawnSync("taskkill.exe", ["/PID", String(worker.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else worker.kill("SIGTERM");
  if (!exited) await new Promise((done) => { worker.once("exit", done); setTimeout(done, 5_000).unref(); });
}
