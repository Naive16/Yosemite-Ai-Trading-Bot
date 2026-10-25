import test from "node:test";
import assert from "node:assert/strict";
import * as workerModule from "../src/worker.js";
import worker from "../src/worker.js";
import { hashPassword } from "../api/_lib/auth.js";
import { routes } from "../api/_lib/worker/routes.js";

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
  const pwHash = await hashPassword("correct-horse-battery-staple", { N: 1024, r: 1, p: 1 });
  const secretsStoreEnv = {
    ...env,
    APP_ENV: "production",
    APP_ORIGIN: "https://yosemite.example.workers.dev",
    AUTH_USERNAME: { async get() { return "Alice"; } },
    AUTH_PASSWORD_HASH: { async get() { return pwHash; } },
    SESSION_SECRET: { async get() { return "x".repeat(40); } },
    DATABASE_URL: { async get() { return "postgresql://user:pass@ep-example-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require"; } }
  };
  const response = await worker.fetch(new Request("https://yosemite.example.workers.dev/api/auth/me"), secretsStoreEnv);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { status: "error", message: "Authentication required" });
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
