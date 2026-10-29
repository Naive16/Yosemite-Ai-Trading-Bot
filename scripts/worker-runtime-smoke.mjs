import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Isolated local Workerd only: synthetic public key, no remote bindings, no
// sign-in or database calls. Never load the user's environment files.
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
  name: "yosemite-local-auth-smoke", main: resolve(root, "src/worker.js"),
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
// Consume bounded CLI output without printing configuration or credential data.
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
  const publicConfig = await get("/api/auth/config");
  assert.equal(publicConfig.status, 200);
  assert.equal((await publicConfig.json()).registrationEnabled, false);
  for (const path of ["/api/auth/me", "/api/private/status", "/api/private/operations", "/api/private/proposals"]) assert.equal((await get(path)).status, 401, path);
  const index = await get("/");
  assert.equal(index.status, 200);
  assert.match(index.headers.get("content-security-policy") || "", /connect-src 'self' https:\/\/txdjozotaxpthpnfikqx.supabase.co/);
  assert.equal((await get("/worker.js")).status, 404);
  assert.equal((await get("/auth-client.js")).status, 404, "auth-client removed with frontend authentication");
  assert.equal((await get("/vendor/supabase.js")).status, 200);
  const health = await (await get("/api/health")).json();
  assert.equal(health.tradingEnabled, false);
  assert.equal(health.liveTradingEnabled, false);
  console.log("Local Workerd smoke passed: public config, protected 401s, static/CSP exclusions, SDK assets and disabled trading");
} finally {
  if (process.platform === "win32" && !exited) spawnSync("taskkill.exe", ["/PID", String(worker.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else worker.kill("SIGTERM");
  if (!exited) await new Promise((done) => { worker.once("exit", done); setTimeout(done, 5_000).unref(); });
}
