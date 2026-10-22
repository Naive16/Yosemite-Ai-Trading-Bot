import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { inspectDeploymentConfig } from "../api/_lib/deployment.js";

const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));

const validProductionEnv = {
  APP_ENV: "production",
  APP_ORIGIN: "https://dashboard.example.test",
  AUTH_USERNAME: "operator",
  AUTH_PASSWORD_HASH: "scrypt$16384$8$1$hash$checksum",
  SESSION_SECRET: "a-secure-session-secret-that-is-long-enough",
  DATABASE_URL: "postgresql://app:secret@ep-example-pooler.us-east-2.aws.neon.tech/db?sslmode=require",
  DATABASE_URL_UNPOOLED: "postgresql://app:secret@ep-example.us-east-2.aws.neon.tech/db?sslmode=require",
  TRADING_MODE: "disabled",
  LIVE_TRADING_ENABLED: "false",
  WORKER_ENABLED: "false",
  MT5_EXECUTION_ENABLED: "false"
};

test("deployment preflight passes safe production configuration without returning secrets", () => {
  const result = inspectDeploymentConfig(validProductionEnv);
  assert.equal(result.ready, true);
  assert.equal(result.failures.length, 0);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("deployment preflight rejects insecure origin and enabled worker", () => {
  const result = inspectDeploymentConfig({ ...validProductionEnv, APP_ORIGIN: "http://dashboard.example.test", WORKER_ENABLED: "true" });
  assert.equal(result.ready, false);
  assert.match(result.failures.join(" "), /HTTPS origin/);
  assert.match(result.failures.join(" "), /WORKER_ENABLED/);
});

test("deployment preflight rejects pooled migration URL and trading enablement", () => {
  const result = inspectDeploymentConfig({ ...validProductionEnv, DATABASE_URL_UNPOOLED: validProductionEnv.DATABASE_URL, TRADING_MODE: "simulation" });
  assert.equal(result.ready, false);
  assert.match(result.failures.join(" "), /direct, non-pooled/);
  assert.match(result.failures.join(" "), /TRADING_MODE/);
});

test("deployment preflight fails closed when production secrets are missing", () => {
  const result = inspectDeploymentConfig({ APP_ENV: "production", APP_ORIGIN: "https://dashboard.example.test" });
  assert.equal(result.ready, false);
  assert.match(result.failures.join(" "), /AUTH_USERNAME/);
  assert.equal(JSON.stringify(result).includes("DATABASE_URL"), false);
});

test("Vercel function pattern covers nested authentication and private routes", async () => {
  assert.ok(vercel.functions?.["api/**/*.js"], "nested API routes must use the recursive function pattern");
  for (const directory of ["auth", "private"]) {
    const files = await readdir(new URL(`../api/${directory}/`, import.meta.url));
    assert.ok(files.some((file) => file.endsWith(".js")));
  }
});
