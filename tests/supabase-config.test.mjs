import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ConfigurationError, loadConfig } from "../api/_lib/config.js";

const url = "https://txdjozotaxpthpnfikqx.supabase.co";
const publicEnv = { APP_ENV: "test", SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only" };
const jwtKey = (payload) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.test_signature`;

test("Supabase configuration has one pinned backend and ignores obsolete credentials", () => {
  const config = loadConfig({ ...publicEnv, AUTH_PASSWORD_HASH: "obsolete", SESSION_SECRET: "obsolete", DATABASE_URL: "obsolete", HYPERDRIVE: {} });
  assert.equal(config.supabase.url, url);
  assert.equal(config.auth.provider, "supabase");
  assert.equal(config.database.provider, "supabase");
  assert.equal(config.auth.configured, true);
  assert.equal(config.database.configured, true);
  assert.equal(config.database.url, undefined);
  assert.equal(config.sessionSecret, undefined);
  assert.throws(() => loadConfig({ ...publicEnv, SUPABASE_URL: "https://other.supabase.co" }), ConfigurationError);
});

test("public key validation rejects privileged and project-mismatched JWT keys", () => {
  for (const value of ["sb_secret_test_only", jwtKey({ role: "service_role", ref: "txdjozotaxpthpnfikqx" }), jwtKey({ role: "anon", ref: "other" }), "malformed"]) {
    assert.throws(() => loadConfig({ ...publicEnv, SUPABASE_PUBLISHABLE_KEY: value }), (error) => error instanceof ConfigurationError && !error.message.includes(value));
  }
  const config = loadConfig({ APP_ENV: "test", SUPABASE_ANON_KEY: jwtKey({ role: "anon", ref: "txdjozotaxpthpnfikqx" }) });
  assert.equal(config.supabase.configured, true);
});

test("production needs an explicit project URL, public key and HTTPS app origin", () => {
  const env = { ...publicEnv, APP_ENV: "production", APP_ORIGIN: "https://dashboard.example.test" };
  assert.equal(loadConfig(env).auth.configured, true);
  for (const key of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "APP_ORIGIN"]) assert.throws(() => loadConfig({ ...env, [key]: "" }), ConfigurationError);
  assert.throws(() => loadConfig({ ...env, APP_ORIGIN: "http://dashboard.example.test" }), ConfigurationError);
  assert.throws(() => loadConfig({ ...env, APP_ORIGIN: "https://user:password@dashboard.example.test" }), ConfigurationError);
});

test("all runtime execution switches remain disabled even with credentials present", () => {
  for (const env of [{ TRADING_MODE: "simulation" }, { LIVE_TRADING_ENABLED: "true" }, { WORKER_ENABLED: "true" }, { MT5_EXECUTION_ENABLED: "true" }, { MT5_DEMO_MODE: "true" }, { MT5_CONNECTOR: "mirro" }]) assert.throws(() => loadConfig({ ...publicEnv, ...env }), ConfigurationError);
  const config = loadConfig(publicEnv);
  assert.equal(config.tradingMode, "disabled");
  assert.equal(config.liveTradingEnabled, false);
  assert.equal(config.worker.enabled, false);
  assert.equal(config.mt5.enabled, false);
  assert.equal(config.mt5.executionEnabled, false);
  assert.equal(config.mt5.connector, "none");
});

test("static asset exclusions live in the configured directory", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const ignore = await readFile(new URL(`../${config.assets.directory}/.assetsignore`, import.meta.url), "utf8");
  assert.match(ignore, /^worker\.js$/m);
  assert.equal(config.vars.TRADING_MODE, "disabled");
  assert.equal(config.vars.WORKER_ENABLED, "false");
  assert.equal(config.vars.MT5_EXECUTION_ENABLED, "false");
});
