import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDatabaseClient, DatabaseQueryError } from "../api/_lib/database.js";
import { loadConfig, ConfigurationError } from "../api/_lib/config.js";

test("database configuration accepts PostgreSQL URLs and rejects invalid values", () => {
  const config = loadConfig({ APP_ENV: "test", DATABASE_URL: "postgresql://user:secret@example.test/db" });
  assert.equal(config.database.configured, true);
  assert.equal(config.database.url, "postgresql://user:secret@example.test/db");
  assert.throws(() => loadConfig({ APP_ENV: "test", DATABASE_URL: "https://example.test/db" }), ConfigurationError);
  assert.throws(() => loadConfig({ APP_ENV: "production", AUTH_USERNAME: "operator", AUTH_PASSWORD_HASH: "scrypt$1024$1$1$abcdefghijklmnop$abcdefghijklmnopabcdefghijklmnopabcdefghijklmnopabcdefghijklmnopabcdefghijklmnopabcdefghijklmnopabcdefghijklmnop", SESSION_SECRET: "a".repeat(32) }), ConfigurationError);
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

test("database adapter parameterizes queries and normalizes driver rows", async () => {
  const calls = [];
  const database = createDatabaseClient({ database: { url: "postgresql://user:secret@example.test/db", queryTimeoutMs: 1_000 } }, () => ({
    async query(text, values) {
      calls.push({ text, values });
      return [{ ok: 1 }];
    }
  }));
  const result = await database.query("SELECT * FROM app_users WHERE username = $1", ["operator"]);
  assert.deepEqual(result.rows, [{ ok: 1 }]);
  assert.deepEqual(calls[0].values, ["operator"]);
  assert.match(calls[0].text, /\$1/);
});

test("database adapter converts driver failures and timeouts to safe database errors", async () => {
  const failing = createDatabaseClient({ database: { url: "postgresql://user:secret@example.test/db", queryTimeoutMs: 1_000 } }, () => ({
    async query() { throw new Error("secret connection detail"); }
  }));
  await assert.rejects(() => failing.query("SELECT 1", []), (error) => error instanceof DatabaseQueryError && error.message === "Database query failed");

  const slow = createDatabaseClient({ database: { url: "postgresql://user:secret@example.test/db", queryTimeoutMs: 5 } }, () => ({
    async query() { await new Promise((resolve) => setTimeout(resolve, 25)); return []; }
  }));
  await assert.rejects(() => slow.query("SELECT 1", []), (error) => error instanceof DatabaseQueryError && error.message === "Database query timed out");
});

test("rate-limit migration is additive, bounded, and indexed for expiry cleanup", async () => {
  const migration = await readFile(new URL("../db/migrations/007_rate_limit_buckets.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS rate_limit_buckets/);
  assert.match(migration, /attempt_count integer NOT NULL CHECK \(attempt_count >= 0\)/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS rate_limit_buckets_expiry_idx/);
  assert.match(migration, /timestamptz NOT NULL/);
  assert.doesNotMatch(migration, /^\s*(DROP|TRUNCATE|DELETE)\b/im);
});
