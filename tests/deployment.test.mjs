import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { inspectDeploymentConfig } from "../api/_lib/deployment.js";

const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));

const validProductionEnv = {
  APP_ENV: "production",
  APP_ORIGIN: "https://dashboard.example.test",
  SUPABASE_URL: "https://txdjozotaxpthpnfikqx.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
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
  assert.match(inspectDeploymentConfig({ ...validProductionEnv, APP_ORIGIN: "http://dashboard.example.test" }).failures.join(" "), /HTTPS/);
  assert.match(inspectDeploymentConfig({ ...validProductionEnv, WORKER_ENABLED: "true" }).failures.join(" "), /WORKER_ENABLED/);
});

test("deployment preflight rejects trading enablement and privileged Supabase keys", () => {
  const result = inspectDeploymentConfig({ ...validProductionEnv, TRADING_MODE: "simulation" });
  assert.equal(result.ready, false);
  assert.match(result.failures.join(" "), /TRADING_MODE/);
  const secret = "sb_secret_fake_never_use";
  const rejected = inspectDeploymentConfig({ ...validProductionEnv, SUPABASE_PUBLISHABLE_KEY: secret });
  assert.equal(rejected.ready, false);
  assert.equal(JSON.stringify(rejected).includes(secret), false);
});

test("deployment preflight fails closed when production secrets are missing", () => {
  const result = inspectDeploymentConfig({ APP_ENV: "production", APP_ORIGIN: "https://dashboard.example.test" });
  assert.equal(result.ready, false);
  assert.match(result.failures.join(" "), /SUPABASE_URL/);
  assert.equal(JSON.stringify(result).includes("DATABASE_URL"), false);
});

test("Vercel function pattern covers nested authentication and private routes", async () => {
  assert.ok(vercel.functions?.["api/**/*.js"], "nested API routes must use the recursive function pattern");
  for (const directory of ["auth", "private"]) {
    const files = await readdir(new URL(`../api/${directory}/`, import.meta.url));
    assert.ok(files.some((file) => file.endsWith(".js")));
  }
});
