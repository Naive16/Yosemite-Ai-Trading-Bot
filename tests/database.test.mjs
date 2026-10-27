import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildPgClientConfig, createDatabaseClient, DatabaseQueryError } from "../api/_lib/database.js";
import { loadConfig, ConfigurationError } from "../api/_lib/config.js";

import { TEST_SUPABASE_ENV } from "./support/fake-supabase.mjs";

test("database configuration accepts Supabase PostgreSQL URLs, supports DIRECT_URL, and rejects invalid or unencrypted production URLs", () => {
  const config = loadConfig({
    APP_ENV: "test",
    DATABASE_URL: "postgresql://postgres.ref:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require",
    DIRECT_URL: "postgresql://postgres.ref:secret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require"
  });
  assert.equal(config.database.configured, true);
  assert.match(config.database.url, /:6543\/postgres/);
  assert.match(config.database.directUrl, /:5432\/postgres/);
  assert.throws(() => loadConfig({ APP_ENV: "test", DATABASE_URL: "https://example.test/db" }), ConfigurationError);
  assert.throws(() => loadConfig({ APP_ENV: "test", DATABASE_URL: "postgresql://user:secret@example.test/" }), ConfigurationError);
  assert.throws(
    () => loadConfig({
      APP_ENV: "test",
      DIRECT_URL: "postgresql://postgres.ref:secret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
      DATABASE_URL_UNPOOLED: "postgresql://postgres:secret@db.ref.supabase.co:5432/postgres"
    }),
    ConfigurationError
  );
  assert.throws(
    () => loadConfig({
      APP_ENV: "production",
      APP_ORIGIN: "https://dashboard.example.test",
      ...TEST_SUPABASE_ENV,
      SESSION_SECRET: "a".repeat(32),
      DATABASE_URL: "postgresql://postgres.ref:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=disable"
    }),
    ConfigurationError
  );
  assert.throws(() => loadConfig({ APP_ENV: "production", ...TEST_SUPABASE_ENV, SESSION_SECRET: "a".repeat(32) }), ConfigurationError);
});

test("buildPgClientConfig configures TLS modes cleanly, preserves certificate verification, and disables inner-socket SSL only for Hyperdrive or local dev", () => {
  const pooled = buildPgClientConfig(
    "postgresql://postgres.ref:p%40ss@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require",
    { queryTimeoutMs: 4_500 }
  );
  assert.equal(pooled.connectionString.includes("pgbouncer"), false);
  assert.equal(pooled.connectionString.includes("sslmode"), false);
  assert.equal(pooled.ssl.rejectUnauthorized, true);
  assert.match(pooled.ssl.ca, /BEGIN CERTIFICATE/);
  assert.equal(pooled.connectionTimeoutMillis, 4_500);
  assert.equal(pooled.query_timeout, 4_500);

  const strictVerifySupabase = buildPgClientConfig(
    "postgresql://postgres:secret@db.ref.supabase.co:5432/postgres?sslmode=verify-full"
  );
  assert.equal(strictVerifySupabase.ssl.rejectUnauthorized, true);
  assert.match(strictVerifySupabase.ssl.ca, /BEGIN CERTIFICATE/);
  assert.equal(strictVerifySupabase.ssl.checkServerIdentity, undefined);

  const verifyCaSupabase = buildPgClientConfig(
    "postgresql://postgres:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=verify-ca"
  );
  assert.equal(verifyCaSupabase.ssl.rejectUnauthorized, true);
  assert.match(verifyCaSupabase.ssl.ca, /BEGIN CERTIFICATE/);
  assert.equal(typeof verifyCaSupabase.ssl.checkServerIdentity, "function");

  const strictVerifyGeneric = buildPgClientConfig(
    "postgresql://postgres:secret@postgres.example.test:5432/postgres?sslmode=verify-full"
  );
  assert.deepEqual(strictVerifyGeneric.ssl, { rejectUnauthorized: true });

  const hyperdriveWithDisable = buildPgClientConfig(
    "postgresql://postgres.ref:secret@c61744a2e2f3567333d4c5cac79bea49.hyperdrive.local:5432/postgres?sslmode=disable"
  );
  assert.equal(hyperdriveWithDisable.ssl, false);
  assert.equal(hyperdriveWithDisable.application_name, undefined);

  const hyperdriveWithoutSslParam = buildPgClientConfig(
    "postgresql://postgres.ref:secret@395fd2032d8441759f4a8d6a641e7eec.hyperdrive.local:5432/postgres"
  );
  assert.equal(hyperdriveWithoutSslParam.ssl, false);
  assert.equal(hyperdriveWithoutSslParam.application_name, undefined);

  const localDev = buildPgClientConfig("postgresql://postgres:secret@localhost:5432/postgres?sslmode=disable");
  assert.equal(localDev.ssl, false);
});

test("loadConfig gives HYPERDRIVE precedence over DATABASE_URL, allows internal .hyperdrive.local proxy in production, and blocks Hyperdrive for DIRECT_URL", () => {
  const hyperdriveConn = "postgresql://postgres.ref:hd-secret@395fd2032d8441759f4a8d6a641e7eec.hyperdrive.local:5432/postgres?sslmode=disable";
  const prodConfig = loadConfig({
    APP_ENV: "production",
    APP_ORIGIN: "https://yosemite-ai-trading-bot.francismkanda01.workers.dev",
    ...TEST_SUPABASE_ENV,
    SESSION_SECRET: "a".repeat(32),
    DATABASE_URL: "postgresql://postgres.ref:stale-secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require",
    HYPERDRIVE: { connectionString: hyperdriveConn }
  });
  assert.equal(prodConfig.database.url, hyperdriveConn);
  assert.equal(prodConfig.database.hyperdrive, true);
  assert.equal(prodConfig.database.configured, true);

  assert.throws(
    () => loadConfig({
      APP_ENV: "production",
      APP_ORIGIN: "https://yosemite-ai-trading-bot.francismkanda01.workers.dev",
      ...TEST_SUPABASE_ENV,
      SESSION_SECRET: "a".repeat(32),
      HYPERDRIVE: { connectionString: hyperdriveConn },
      DIRECT_URL: hyperdriveConn
    }),
    (error) => error instanceof ConfigurationError && /DIRECT_URL/.test(error.message) && !error.message.includes("hd-secret")
  );
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

test("Supabase RLS hardening migration is additive and enables RLS across all 21 application tables", async () => {
  const migration = await readFile(new URL("../db/migrations/008_supabase_rls_hardening.sql", import.meta.url), "utf8");
  const allTables = [
    "schema_migrations",
    "app_users",
    "auth_sessions",
    "audit_events",
    "risk_configurations",
    "risk_daily_state",
    "risk_account_snapshots",
    "risk_position_snapshots",
    "risk_evaluations",
    "trade_proposals",
    "trade_proposal_decisions",
    "backtest_runs",
    "paper_events",
    "paper_positions",
    "paper_trades",
    "execution_intents",
    "execution_transitions",
    "operational_alerts",
    "worker_leases",
    "recovery_tasks",
    "rate_limit_buckets"
  ];
  for (const relation of allTables) {
    assert.match(migration, new RegExp(`ALTER TABLE ${relation} ENABLE ROW LEVEL SECURITY;`));
  }
  assert.doesNotMatch(migration, /^\s*(DROP|TRUNCATE|DELETE)\b/im);
});

test("database adapter commits and rolls back explicit SQL transactions cleanly", async () => {
  const statements = [];
  const database = createDatabaseClient({ database: { url: "postgresql://user:secret@example.test/db", queryTimeoutMs: 1_000 } }, () => ({
    async query(text, values) {
      statements.push({ text, values });
      return { rows: [{ ok: 1 }] };
    }
  }));

  const committed = await database.transaction(async (tx) => {
    await tx.query("INSERT INTO audit_events (id, event_type) VALUES ($1, $2)", ["evt_12345678901234567890", "test.event"]);
    return "committed";
  });
  assert.equal(committed, "committed");
  assert.deepEqual(statements.map((item) => item.text), [
    "BEGIN",
    "INSERT INTO audit_events (id, event_type) VALUES ($1, $2)",
    "COMMIT"
  ]);

  statements.length = 0;
  assert.throws(
    () => loadConfig({ APP_ENV: "test", DATABASE_URL: "postgresql://user:secret@ep-legacy-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require" }),
    (error) => error instanceof ConfigurationError && /legacy Neon host/.test(error.message) && !error.message.includes("secret")
  );
  assert.throws(
    () => loadConfig({ APP_ENV: "test", DIRECT_URL: "postgresql://user:secret@ep-legacy.us-east-2.aws.neon.tech/neondb?sslmode=require" }),
    (error) => error instanceof ConfigurationError && /legacy Neon host/.test(error.message) && !error.message.includes("secret")
  );
  const pinnedSupabaseVerifyFull = buildPgClientConfig(
    "postgresql://postgres.testref:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full"
  );
  assert.equal(pinnedSupabaseVerifyFull.ssl.rejectUnauthorized, true);
  assert.match(pinnedSupabaseVerifyFull.ssl.ca, /BEGIN CERTIFICATE/);
  assert.doesNotMatch(pinnedSupabaseVerifyFull.connectionString, /sslmode=/);

  await assert.rejects(
    () =>
      database.transaction(async (tx) => {
        await tx.query("UPDATE trade_proposals SET status = $1", ["approved"]);
        throw new Error("domain_abort");
      }),
    /domain_abort/
  );
  assert.deepEqual(statements.map((item) => item.text), [
    "BEGIN",
    "UPDATE trade_proposals SET status = $1",
    "ROLLBACK"
  ]);
});
