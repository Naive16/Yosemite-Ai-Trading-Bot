import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
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

test("wrangler.jsonc preserves production origin, Hyperdrive binding, keep_vars, observability logs, and disabled trading flags", () => {
  const wranglerConfig = JSON.parse(fs.readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(wranglerConfig.keep_vars, true);
  assert.deepEqual(wranglerConfig.hyperdrive, [
    {
      binding: "HYPERDRIVE",
      id: "395fd2032d8441759f4a8d6a641e7eec"
    }
  ]);
  assert.equal(wranglerConfig.vars.APP_ENV, "production");
  assert.equal(wranglerConfig.vars.APP_ORIGIN, "https://yosemite-ai-trading-bot.francismkanda01.workers.dev");
  assert.equal(wranglerConfig.vars.TRADING_MODE, "disabled");
  assert.equal(wranglerConfig.vars.LIVE_TRADING_ENABLED, "false");
  assert.equal(wranglerConfig.vars.WORKER_ENABLED, "false");
  assert.equal(wranglerConfig.vars.MT5_EXECUTION_ENABLED, "false");
  assert.equal(wranglerConfig.vars.MT5_DEMO_MODE, "false");
  assert.equal(wranglerConfig.vars.MT5_CONNECTOR, "none");
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

test("Worker gives HYPERDRIVE precedence over DATABASE_URL regardless of binding order or Secrets Store fallback", async () => {
  const hyperdriveUrl = "postgresql://postgres.testref:hd-pass@395fd2032d8441759f4a8d6a641e7eec.hyperdrive.local:5432/postgres?sslmode=disable";
  const legacyNeonUrlThatWouldFail = "postgresql://user:legacy-pass@ep-old.us-east-2.aws.neon.tech/neondb?sslmode=require";

  // Case 1: HYPERDRIVE appears before plain-string DATABASE_URL
  const envHyperdriveFirst = {
    ...env,
    APP_ENV: "production",
    APP_ORIGIN: "https://yosemite-ai-trading-bot.francismkanda01.workers.dev",
    SUPABASE_URL: TEST_SUPABASE_URL,
    SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY,
    SUPABASE_OWNER_USER_ID: TEST_SUPABASE_OWNER_ID,
    SESSION_SECRET: "x".repeat(40),
    HYPERDRIVE: { connectionString: hyperdriveUrl },
    DATABASE_URL: legacyNeonUrlThatWouldFail
  };
  const res1 = await worker.fetch(new Request("https://yosemite-ai-trading-bot.francismkanda01.workers.dev/api/auth/me"), envHyperdriveFirst);
  assert.equal(res1.status, 401);
  assert.deepEqual(await res1.json(), { status: "error", message: "Authentication required" });

  // Case 2: Async Secrets Store DATABASE_URL appears before HYPERDRIVE
  const envDatabaseFirst = {
    ...env,
    APP_ENV: "production",
    APP_ORIGIN: "https://yosemite-ai-trading-bot.francismkanda01.workers.dev",
    SUPABASE_URL: TEST_SUPABASE_URL,
    SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY,
    SUPABASE_OWNER_USER_ID: TEST_SUPABASE_OWNER_ID,
    SESSION_SECRET: "x".repeat(40),
    DATABASE_URL: { async get() { return legacyNeonUrlThatWouldFail; } },
    HYPERDRIVE: { connectionString: hyperdriveUrl }
  };
  const res2 = await worker.fetch(new Request("https://yosemite-ai-trading-bot.francismkanda01.workers.dev/api/auth/me"), envDatabaseFirst);
  assert.equal(res2.status, 401);
  assert.deepEqual(await res2.json(), { status: "error", message: "Authentication required" });
});

function pgMsg(typeChar, payloadBuf = Buffer.alloc(0)) {
  const header = Buffer.alloc(5);
  header.write(typeChar, 0, 1, "ascii");
  header.writeInt32BE(payloadBuf.length + 4, 1);
  return Buffer.concat([header, payloadBuf]);
}

function makeSelectOneRowDesc() {
  const colName = Buffer.from("ok\0", "ascii");
  const fieldMeta = Buffer.alloc(18);
  fieldMeta.writeInt32BE(23, 6);
  fieldMeta.writeInt16BE(4, 10);
  fieldMeta.writeInt32BE(-1, 12);
  const rdHeader = Buffer.alloc(2);
  rdHeader.writeInt16BE(1, 0);
  return pgMsg("T", Buffer.concat([rdHeader, colName, fieldMeta]));
}

function makeSelectOneDataAndComplete() {
  const drHeader = Buffer.alloc(6);
  drHeader.writeInt16BE(1, 0);
  drHeader.writeInt32BE(1, 2);
  return Buffer.concat([
    pgMsg("D", Buffer.concat([drHeader, Buffer.from("1", "ascii")])),
    pgMsg("C", Buffer.from("SELECT 1\0", "ascii"))
  ]);
}

test("workerd executes pg queries over Hyperdrive (.hyperdrive.local) with upstream private-CA TLS verification while overriding broken DATABASE_URL", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yosemite-hd-test-"));
  const keyPath = path.join(tmpDir, "key.pem");
  const certPath = path.join(tmpDir, "cert.pem");
  const outDir = path.join(tmpDir, "dist");

  execFileSync("openssl", [
    "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
    "-keyout", keyPath,
    "-out", certPath,
    "-days", "1", "-nodes", "-subj", "/CN=Supabase Root 2021 CA"
  ], { stdio: "ignore" });
  const key = fs.readFileSync(keyPath);
  const cert = fs.readFileSync(certPath);

  execFileSync("npx", ["wrangler", "deploy", "--dry-run", `--outdir=${outDir}`], {
    cwd: path.resolve(new URL("..", import.meta.url).pathname),
    stdio: "ignore"
  });

  let tlsHandshakes = 0;
  let observedQuery = "";
  const activeSockets = new Set();
  const pgServer = net.createServer((rawSocket) => {
    activeSockets.add(rawSocket);
    rawSocket.once("close", () => activeSockets.delete(rawSocket));
    rawSocket.once("data", (firstChunk) => {
      if (firstChunk.length === 8 && firstChunk.readInt32BE(4) === 80877103) {
        rawSocket.write("S");
        const tlsSocket = new tls.TLSSocket(rawSocket, { isServer: true, key, cert });
        tlsSocket.once("secure", () => { tlsHandshakes += 1; });
        let started = false;
        let buf = Buffer.alloc(0);
        tlsSocket.on("data", (chunk) => {
          buf = Buffer.concat([buf, chunk]);
          if (!started) {
            if (buf.length < 4) return;
            const startupLen = buf.readInt32BE(0);
            if (buf.length < startupLen) return;
            buf = buf.subarray(startupLen);
            started = true;
            tlsSocket.write(Buffer.concat([pgMsg("R", Buffer.from([0, 0, 0, 0])), pgMsg("Z", Buffer.from("I", "ascii"))]));
          }
          while (buf.length >= 5) {
            const msgType = String.fromCharCode(buf[0]);
            const msgLen = buf.readInt32BE(1);
            if (buf.length < 1 + msgLen) break;
            const payload = buf.subarray(5, 1 + msgLen);
            buf = buf.subarray(1 + msgLen);
            if (msgType === "Q") {
              observedQuery = payload.toString("utf8");
              tlsSocket.write(Buffer.concat([makeSelectOneRowDesc(), makeSelectOneDataAndComplete(), pgMsg("Z", Buffer.from("I", "ascii"))]));
            } else if (msgType === "P") {
              observedQuery = payload.toString("utf8");
              tlsSocket.write(pgMsg("1"));
            } else if (msgType === "B") {
              tlsSocket.write(pgMsg("2"));
            } else if (msgType === "D") {
              tlsSocket.write(Buffer.concat([pgMsg("t", Buffer.from([0, 0])), makeSelectOneRowDesc()]));
            } else if (msgType === "E") {
              tlsSocket.write(makeSelectOneDataAndComplete());
            } else if (msgType === "S") {
              tlsSocket.write(pgMsg("Z", Buffer.from("I", "ascii")));
            } else if (msgType === "X") {
              tlsSocket.end();
              return;
            }
          }
        });
      } else {
        rawSocket.destroy();
      }
    });
  });

  await new Promise((resolve) => pgServer.listen(0, "127.0.0.1", resolve));
  const port = pgServer.address().port;
  const bundledScript = fs.readFileSync(path.join(outDir, "worker.js"), "utf8");

  const mf = new Miniflare({
    modules: true,
    script: bundledScript,
    compatibilityDate: "2026-05-03",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      APP_ENV: "production",
      APP_ORIGIN: "https://yosemite-ai-trading-bot.francismkanda01.workers.dev",
      TRADING_MODE: "disabled",
      LIVE_TRADING_ENABLED: "false",
      WORKER_ENABLED: "false",
      MT5_EXECUTION_ENABLED: "false",
      MT5_DEMO_MODE: "false",
      MT5_CONNECTOR: "none",
      SUPABASE_URL: TEST_SUPABASE_URL,
      SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY,
      SUPABASE_OWNER_USER_ID: TEST_SUPABASE_OWNER_ID,
      SESSION_SECRET: "x".repeat(40),
      DATABASE_URL: "postgresql://postgres.ref:broken-secret@127.0.0.1:1/postgres?sslmode=require"
    },
    hyperdrives: {
      HYPERDRIVE: `postgresql://postgres.ref:hd-secret@127.0.0.1:${port}/postgres?sslmode=verify-ca&sslrootcert=${encodeURIComponent(certPath)}`
    }
  });

  try {
    const response = await mf.dispatchFetch("https://yosemite-ai-trading-bot.francismkanda01.workers.dev/api/health?probe=database");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.services.database, "operational");
    assert.equal(body.tradingEnabled, false);
    assert.equal(body.liveTradingEnabled, false);
    assert.ok(tlsHandshakes >= 1, "Hyperdrive upstream connection must negotiate verified TLS");
    assert.match(observedQuery, /clock_timestamp\(\)/, "Probe query must bypass Hyperdrive query caching");
  } finally {
    await mf.dispose().catch(() => {});
    for (const sock of activeSockets) sock.destroy();
    await new Promise((resolve) => pgServer.close(() => resolve()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
