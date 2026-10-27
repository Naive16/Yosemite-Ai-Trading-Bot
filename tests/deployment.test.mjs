import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { inspectDeploymentConfig } from "../api/_lib/deployment.js";

import { TEST_SUPABASE_ENV } from "./support/fake-supabase.mjs";

const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));

const validProductionEnv = {
  APP_ENV: "production",
  APP_ORIGIN: "https://dashboard.example.test",
  ...TEST_SUPABASE_ENV,
  SESSION_SECRET: "a-secure-session-secret-that-is-long-enough",
  DATABASE_URL: "postgresql://postgres.exampleproject:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require",
  DIRECT_URL: "postgresql://postgres.exampleproject:secret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require",
  TRADING_MODE: "disabled",
  LIVE_TRADING_ENABLED: "false",
  WORKER_ENABLED: "false",
  MT5_EXECUTION_ENABLED: "false"
};

test("deployment preflight passes safe Supabase production configuration without returning secrets", () => {
  const result = inspectDeploymentConfig(validProductionEnv);
  assert.equal(result.ready, true);
  assert.equal(result.failures.length, 0);
  assert.equal(JSON.stringify(result).includes("secret"), false);

  const directIpv6 = inspectDeploymentConfig({
    ...validProductionEnv,
    DIRECT_URL: "postgresql://postgres:secret@db.exampleproject.supabase.co:5432/postgres?sslmode=require"
  });
  assert.equal(directIpv6.ready, true);
  assert.equal(directIpv6.failures.length, 0);

  const withHyperdrive = inspectDeploymentConfig({
    APP_ENV: "production",
    APP_ORIGIN: "https://dashboard.example.test",
    ...TEST_SUPABASE_ENV,
    SESSION_SECRET: "a-secure-session-secret-that-is-long-enough",
    HYPERDRIVE: {
      connectionString: "postgresql://postgres.exampleproject:hd-secret@395fd2032d8441759f4a8d6a641e7eec.hyperdrive.local:5432/postgres?sslmode=disable"
    },
    TRADING_MODE: "disabled",
    LIVE_TRADING_ENABLED: "false",
    WORKER_ENABLED: "false",
    MT5_EXECUTION_ENABLED: "false"
  });
  assert.equal(withHyperdrive.ready, true);
  assert.equal(withHyperdrive.failures.length, 0);
  assert.match(withHyperdrive.warnings.join(" "), /caching-disabled/);
  assert.equal(JSON.stringify(withHyperdrive).includes("hd-secret"), false);
});

test("deployment preflight rejects insecure origin and enabled worker", () => {
  const result = inspectDeploymentConfig({ ...validProductionEnv, APP_ORIGIN: "http://dashboard.example.test", WORKER_ENABLED: "true" });
  assert.equal(result.ready, false);
  assert.match(result.failures.join(" "), /HTTPS origin/);
  assert.match(result.failures.join(" "), /WORKER_ENABLED/);
});

test("deployment preflight rejects transaction-pooled migration URL, legacy Neon hosts, disabled TLS, and trading enablement", () => {
  const result = inspectDeploymentConfig({
    ...validProductionEnv,
    DIRECT_URL: validProductionEnv.DATABASE_URL,
    TRADING_MODE: "simulation"
  });
  assert.equal(result.ready, false);
  assert.match(result.failures.join(" "), /transaction pooler/);
  assert.match(result.failures.join(" "), /TRADING_MODE/);

  const legacyNeon = inspectDeploymentConfig({
    ...validProductionEnv,
    DATABASE_URL: "postgresql://app:secret@ep-example-pooler.us-east-2.aws.neon.tech/db?sslmode=require"
  });
  assert.equal(legacyNeon.ready, false);
  assert.match(legacyNeon.failures.join(" "), /legacy Neon host/);
  assert.equal(JSON.stringify(legacyNeon).includes("secret"), false);

  const disabledTls = inspectDeploymentConfig({
    ...validProductionEnv,
    DATABASE_URL: "postgresql://postgres.exampleproject:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=disable"
  });
  assert.equal(disabledTls.ready, false);
  assert.match(disabledTls.failures.join(" "), /TLS/);
});

test("deployment preflight fails closed when production secrets are missing or service-role key is set", () => {
  const result = inspectDeploymentConfig({ APP_ENV: "production", APP_ORIGIN: "https://dashboard.example.test" });
  assert.equal(result.ready, false);
  assert.match(result.failures.join(" "), /SUPABASE_URL/);
  assert.equal(JSON.stringify(result).includes("DATABASE_URL"), false);

  const withServiceRole = inspectDeploymentConfig({ ...validProductionEnv, SUPABASE_SERVICE_ROLE_KEY: "do-not-allow" });
  assert.equal(withServiceRole.ready, false);
  assert.match(withServiceRole.failures.join(" "), /service-role/);
  assert.equal(JSON.stringify(withServiceRole).includes("do-not-allow"), false);
});

test("Vercel function pattern covers nested authentication and private routes", async () => {
  assert.ok(vercel.functions?.["api/**/*.js"], "nested API routes must use the recursive function pattern");
  for (const directory of ["auth", "private"]) {
    const files = await readdir(new URL(`../api/${directory}/`, import.meta.url));
    assert.ok(files.some((file) => file.endsWith(".js")));
  }
});
