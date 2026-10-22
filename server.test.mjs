import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createServer, readBody, routeRegistry, validateStartupConfig } from "../server.js";

let server;
let origin;

before(async () => {
  server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { await new Promise((resolve) => server.close(resolve)); });

test("route registry maps every public application endpoint", () => {
  assert.deepEqual(routeRegistry.map(({ method, path }) => `${method} ${path}`), [
    "GET /api/health", "POST /api/auth/login", "GET /api/auth/me", "POST /api/auth/logout",
    "GET /api/private/status", "GET /api/private/operations", "GET /api/private/market-data",
    "GET /api/private/strategy", "GET /api/private/analysis", "GET /api/private/risk",
    "GET /api/private/proposals", "POST /api/private/proposals", "GET /api/private/backtest",
    "POST /api/private/backtest", "GET /api/private/paper", "POST /api/private/paper"
  ]);
});

test("health and frontend are served through the standard HTTP server", async () => {
  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).tradingEnabled, false);
  assert.equal(health.headers.get("x-content-type-options"), "nosniff");
  const frontend = await fetch(`${origin}/`);
  assert.equal(frontend.status, 200);
  assert.match(await frontend.text(), /Yosemite AI/);
  assert.match(frontend.headers.get("content-security-policy"), /default-src 'self'/);
});

test("unknown routes, unsupported methods, and static traversal stay contained", async () => {
  const unknownApi = await fetch(`${origin}/api/not-a-route`);
  assert.equal(unknownApi.status, 404);
  assert.deepEqual(await unknownApi.json(), { status: "error", message: "API route not found" });
  const unsupported = await fetch(`${origin}/api/health`, { method: "POST" });
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get("allow"), "GET");
  const traversal = await fetch(`${origin}/..%2F.env`);
  assert.equal(traversal.status, 404);
});

test("request bodies are bounded and malformed JSON remains a client error at the parser boundary", async () => {
  const oversized = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "user", password: "x".repeat(70_000) }) });
  assert.equal(oversized.status, 413);
  const malformed = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  assert.notEqual(malformed.status, 500);
  const stream = Readable.from([Buffer.from("{"), Buffer.from("}")]);
  stream.method = "POST"; stream.headers = { "content-length": "2" };
  assert.equal(await readBody(stream, 4), "{}");
});

test("production startup fails closed without production configuration", () => {
  assert.throws(() => validateStartupConfig({ APP_ENV: "production" }), /Production configuration is invalid/);
});
