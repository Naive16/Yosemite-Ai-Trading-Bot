import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import * as workerModule from "../src/worker.js";
import worker from "../src/worker.js";
import { routes } from "../api/_lib/worker/routes.js";
import { TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_OWNER_ID, TEST_SUPABASE_URL } from "./support/fake-supabase.mjs";

const env = {
  APP_ENV: "test",
  APP_ORIGIN: "http://localhost:8787",
  TRADING_MODE: "disabled",
  LIVE_TRADING_ENABLED: "false",
  ASSETS: { fetch: async () => new Response("<html>Yosemite AI</html>", { status: 200, headers: { "Content-Type": "text/html" } }) }
};

test("Worker entrypoint exports only default handler for workerd compatibility", () => {
  assert.deepEqual(Object.keys(workerModule), ["default"]);
  assert.equal(typeof worker.fetch, "function");
});

test("Worker maps the health endpoint through Fetch API adapters", async () => {
  const response = await worker.fetch(new Request("http://localhost/api/health"), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).tradingEnabled, false);
});

test("Worker resolves Cloudflare Secrets Store async bindings into runtimeEnv", async () => {
  const secretsStoreEnv = {
    ...env,
    APP_ENV: "production",
    APP_ORIGIN: "https://yosemite-ai-trading-bot.francismkanda01.workers.dev",
    SUPABASE_URL: { async get() { return TEST_SUPABASE_URL; } },
    SUPABASE_ANON_KEY: { async get() { return TEST_SUPABASE_ANON_KEY; } },
    SUPABASE_OWNER_USER_ID: { async get() { return TEST_SUPABASE_OWNER_ID; } },
    SESSION_SECRET: { async get() { return "x".repeat(40); } },
    DATABASE_URL: { async get() { return "postgresql://postgres.testref:pass@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require"; } }
  };
  const response = await worker.fetch(new Request("https://yosemite-ai-trading-bot.francismkanda01.workers.dev/api/auth/me"), secretsStoreEnv);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { status: "error", message: "Authentication required" });
});

test("Worker logs missingRequiredKeys and failedSecretBindings without exposing secret values", async () => {
  const secretAnonKey = "sb_publishable_never_log_this_key_value_12345";
  const secretDbUrl = "postgresql://postgres.testref:ultra-secret-db-pass@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require";
  const incompleteEnv = {
    ...env,
    APP_ENV: "production",
    APP_ORIGIN: "https://yosemite-ai-trading-bot.francismkanda01.workers.dev",
    SUPABASE_URL: TEST_SUPABASE_URL,
    SUPABASE_ANON_KEY: secretAnonKey,
    DATABASE_URL: secretDbUrl,
    SESSION_SECRET: { async get() { throw new Error("Secret not found"); } }
  };

  const capturedErrors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => capturedErrors.push(args.join(" "));
  try {
    const response = await worker.fetch(new Request("https://yosemite-ai-trading-bot.francismkanda01.workers.dev/api/auth/me"), incompleteEnv);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: "error", message: "Authentication is not configured" });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(capturedErrors.length, 1);
  assert.equal(capturedErrors[0].includes(secretAnonKey), false);
  assert.equal(capturedErrors[0].includes("ultra-secret-db-pass"), false);
  const diagnostic = JSON.parse(capturedErrors[0]);
  assert.equal(diagnostic.event, "worker.config_validation_failed");
  assert.equal(diagnostic.reason, "SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_OWNER_USER_ID are required in production");
  assert.deepEqual(diagnostic.missingRequiredKeys, ["SESSION_SECRET", "SUPABASE_OWNER_USER_ID"]);
  assert.deepEqual(diagnostic.failedSecretBindings, ["SESSION_SECRET"]);
});

test("wrangler.jsonc preserves production origin, keep_vars, observability logs, and disabled trading flags", () => {
  const wranglerConfig = JSON.parse(fs.readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(wranglerConfig.keep_vars, true);
  assert.equal(wranglerConfig.vars.APP_ENV, "production");
  assert.equal(wranglerConfig.vars.APP_ORIGIN, "https://yosemite-ai-trading-bot.francismkanda01.workers.dev");
  assert.equal(wranglerConfig.vars.TRADING_MODE, "disabled");
  assert.equal(wranglerConfig.vars.LIVE_TRADING_ENABLED, "false");
  assert.equal(wranglerConfig.vars.WORKER_ENABLED, "false");
  assert.equal(wranglerConfig.vars.MT5_EXECUTION_ENABLED, "false");
  assert.equal(wranglerConfig.observability?.logs?.enabled, true);
});

test("Worker routes preserve unsupported-method and unknown-route behavior", async () => {
  const methodResponse = await worker.fetch(new Request("http://localhost/api/health", { method: "POST" }), env);
  assert.equal(methodResponse.status, 405);
  const unknownResponse = await worker.fetch(new Request("http://localhost/api/nope"), env);
  assert.equal(unknownResponse.status, 404);
  assert.equal((await unknownResponse.json()).message, "API route not found");
});

test("Worker bounds request bodies before invoking handlers", async () => {
  const response = await worker.fetch(new Request("http://localhost/api/auth/login", { method: "POST", body: "x".repeat(65 * 1024) }), env);
  assert.equal(response.status, 413);
});

test("Worker delegates static assets without exposing API source routes", async () => {
  const response = await worker.fetch(new Request("http://localhost/"), env);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Yosemite AI/);
  assert.equal(routes.length, 16);
});

test("Worker resolves optional Hyperdrive connectionString binding when DATABASE_URL is delegated", async () => {
  const hyperdriveEnv = {
    ...env,
    APP_ENV: "production",
    APP_ORIGIN: "https://yosemite-ai-trading-bot.francismkanda01.workers.dev",
    SUPABASE_URL: TEST_SUPABASE_URL,
    SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY,
    SUPABASE_OWNER_USER_ID: TEST_SUPABASE_OWNER_ID,
    SESSION_SECRET: "x".repeat(40),
    HYPERDRIVE: { connectionString: "postgresql://postgres.testref:pass@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require" }
  };
  const response = await worker.fetch(new Request("https://yosemite-ai-trading-bot.francismkanda01.workers.dev/api/auth/me"), hyperdriveEnv);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { status: "error", message: "Authentication required" });
});
