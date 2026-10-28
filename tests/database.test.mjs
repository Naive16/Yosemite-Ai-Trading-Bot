import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDatabaseClient, DatabaseQueryError } from "../api/_lib/database.js";
import { loadConfig, ConfigurationError } from "../api/_lib/config.js";

test("database configuration uses only the intended Supabase project", () => {
  const config = loadConfig({ APP_ENV: "test", SUPABASE_URL: "https://txdjozotaxpthpnfikqx.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-only" });
  assert.equal(config.database.configured, true);
  assert.equal(config.supabase.url, "https://txdjozotaxpthpnfikqx.supabase.co");
  assert.equal(loadConfig({ APP_ENV: "test", DATABASE_URL: "postgresql://user:secret@example.test/db" }).database.configured, false);
  assert.throws(() => loadConfig({ APP_ENV: "test", SUPABASE_URL: "https://different-project.supabase.co" }), ConfigurationError);
  assert.throws(() => loadConfig({ APP_ENV: "production" }), ConfigurationError);
});

test("initial migration is additive and contains required durable tables and indexes", async () => {
  const migration = await readFile(new URL("../db/migrations/001_initial_schema.sql", import.meta.url), "utf8");
  for (const relation of ["schema_migrations", "app_users", "auth_sessions", "audit_events"]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${relation}`));
  for (const index of ["auth_sessions_user_id_idx", "auth_sessions_expiry_idx", "audit_events_user_created_idx", "audit_events_type_created_idx"]) assert.match(migration, new RegExp(`CREATE INDEX IF NOT EXISTS ${index}`));
  assert.match(migration, /timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(migration, /REFERENCES app_users\(id\) ON DELETE CASCADE/);
  assert.match(migration, /REFERENCES app_users\(id\) ON DELETE SET NULL/);
  assert.doesNotMatch(migration, /^\s*(DROP|TRUNCATE|DELETE)\b/im);
});

test("risk migration is additive and contains versioned risk state tables", async () => {
  const migration = await readFile(new URL("../db/migrations/002_risk_engine.sql", import.meta.url), "utf8");
  for (const relation of ["risk_configurations", "risk_daily_state", "risk_account_snapshots", "risk_position_snapshots", "risk_evaluations"]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${relation}`));
  for (const index of ["risk_configurations_active_idx", "risk_account_snapshots_captured_idx", "risk_position_snapshots_captured_idx", "risk_evaluations_decision_created_idx"]) assert.match(migration, new RegExp(`CREATE .*INDEX IF NOT EXISTS ${index}`));
  assert.match(migration, /timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.doesNotMatch(migration, /^\s*(DROP|TRUNCATE|DELETE)\b/im);
});

test("proposal migration is additive and enforces immutable proposal states", async () => {
  const migration = await readFile(new URL("../db/migrations/003_trade_proposals.sql", import.meta.url), "utf8");
  for (const relation of ["trade_proposals", "trade_proposal_decisions"]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${relation}`));
  for (const index of ["trade_proposals_user_status_idx", "trade_proposals_expiry_idx", "trade_proposal_decisions_proposal_idx"]) assert.match(migration, new RegExp(`CREATE .*INDEX IF NOT EXISTS ${index}`));
  assert.match(migration, /content_digest text NOT NULL CHECK \(char_length\(content_digest\) = 64\)/);
  assert.match(migration, /status IN \('pending_approval', 'blocked', 'approved', 'rejected', 'expired', 'invalidated', 'superseded'\)/);
  assert.doesNotMatch(migration, /^\s*(DROP|TRUNCATE|DELETE)\b/im);
});

test("simulation migration keeps backtest and paper records explicitly separate", async () => {
  const migration = await readFile(new URL("../db/migrations/004_paper_backtest.sql", import.meta.url), "utf8");
  for (const relation of ["backtest_runs", "paper_events", "paper_positions", "paper_trades"]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${relation}`));
  assert.match(migration, /simulated boolean NOT NULL DEFAULT true CHECK \(simulated = true\)/);
  assert.doesNotMatch(migration, /^\s*(DROP|TRUNCATE|DELETE)\b/im);
});

test("execution reconciliation migration is additive and state-constrained", async () => {
  const sql = await readFile(new URL("../db/migrations/005_execution_reconciliation.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS execution_intents/);
  assert.match(sql, /idempotency_key text NOT NULL UNIQUE/);
  assert.match(sql, /reconciliation_required/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS execution_transitions/);
  assert.doesNotMatch(sql, /^\s*(DROP|TRUNCATE|DELETE)\b/im);
});

test("database clients carry only the verified request JWT and remain isolated", async () => {
  const calls = [];
  const config = { supabase: { url: "https://txdjozotaxpthpnfikqx.supabase.co", key: "public-test-key", queryTimeoutMs: 1_000 } };
  const factory = (url,key,options) => { calls.push({url,key,options}); return { rpc: async () => ({ data: [{ active_session: true, user_id: "legacy-id" }], error: null }) }; };
  const first = createDatabaseClient(config,factory); const second = createDatabaseClient(config,factory);
  first.authorize("verified-first-token"); second.authorize("verified-second-token");
  assert.equal(calls[2].options.global.headers.Authorization,"Bearer verified-first-token");
  assert.equal(calls[3].options.global.headers.Authorization,"Bearer verified-second-token");
  assert.notEqual(first.client,second.client);
  assert.equal((await first.verifySession()).user_id,"legacy-id");
  assert.equal(calls[0].options.auth.persistSession,false);
});

test("database adapter converts Data API failures and timeouts to safe errors", async () => {
  const config = { supabase: { url: "https://txdjozotaxpthpnfikqx.supabase.co", key: "public-test-key", queryTimeoutMs: 5 } };
  const database = createDatabaseClient(config,() => ({}));
  await assert.rejects(() => database.execute(Promise.resolve({ error: { message: "secret connection detail" } })), error => error instanceof DatabaseQueryError && error.message === "Supabase database query failed");
  await assert.rejects(() => database.execute(new Promise(resolve => setTimeout(resolve,25))), error => error instanceof DatabaseQueryError && error.message === "Supabase database query timed out");
});

test("rate-limit migration is additive, bounded, and indexed for expiry cleanup", async () => {
  const migration = await readFile(new URL("../db/migrations/007_rate_limit_buckets.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS rate_limit_buckets/);
  assert.match(migration, /attempt_count integer NOT NULL CHECK \(attempt_count >= 0\)/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS rate_limit_buckets_expiry_idx/);
  assert.match(migration, /timestamptz NOT NULL/);
  assert.doesNotMatch(migration, /^\s*(DROP|TRUNCATE|DELETE)\b/im);
});
