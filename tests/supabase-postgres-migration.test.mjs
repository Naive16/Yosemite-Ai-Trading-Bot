import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

import loginHandler from "../api/auth/login.js";
import meHandler from "../api/auth/me.js";
import logoutHandler from "../api/auth/logout.js";
import operationsHandler from "../api/private/operations.js";
import proposalsHandler from "../api/private/proposals.js";
import { clearAuthState } from "../api/_lib/auth.js";
import {
  clearDatabaseTestOverride,
  createDatabaseClient,
  DatabaseQueryError,
  setDatabaseForTests
} from "../api/_lib/database.js";
import { consumeRateLimit } from "../api/_lib/rate-limit.js";
import { loadRiskConfiguration, recordRiskEvaluation } from "../api/_lib/risk/repository.js";
import { createProposal } from "../api/_lib/proposals/canonical.js";
import { insertProposal } from "../api/_lib/proposals/repository.js";
import { setSupabaseFetchForTests } from "../api/_lib/supabase.js";
import { directDatabaseUrl, runMigrations, splitSqlStatements } from "../scripts/migrate.mjs";
import { migrateNeonToSupabase, validateDataMigrationEnv } from "../scripts/migrate-neon-to-supabase.mjs";
import {
  createFakeSupabaseFetch,
  TEST_OWNER_EMAIL,
  TEST_OWNER_PASSWORD,
  TEST_SUPABASE_ENV,
  TEST_SUPABASE_OWNER_ID
} from "./support/fake-supabase.mjs";

const ALL_PUBLIC_TABLES = [
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

const APP_ORIGIN = "http://localhost:3000";

function createPgliteDatabaseClient(pg) {
  return createDatabaseClient(
    {
      database: {
        url: "postgresql://postgres.testref:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require",
        queryTimeoutMs: 5_000
      }
    },
    () => ({
      async query(text, values = []) {
        return pg.query(text, values);
      }
    })
  );
}

function responseDouble() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function cookieFrom(response) {
  return (response.headers["Set-Cookie"] || "").split(";")[0];
}

function makeRequest({
  url = "http://localhost:3000/api/auth/me",
  method = "GET",
  body,
  cookie = "",
  csrf = "",
  origin = APP_ORIGIN,
  ip = "198.51.100.42"
} = {}) {
  const headers = {
    origin,
    "x-forwarded-for": ip
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  if (csrf) headers["x-csrf-token"] = csrf;
  return {
    url,
    method,
    headers,
    body,
    runtimeEnv: {
      APP_ENV: "test",
      APP_ORIGIN,
      ...TEST_SUPABASE_ENV,
      SESSION_SECRET: "supabase-postgres-integration-session-secret-32b",
      DATABASE_URL: "postgresql://postgres.testref:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require",
      TRADING_MODE: "disabled",
      LIVE_TRADING_ENABLED: "false",
      WORKER_ENABLED: "false",
      MT5_EXECUTION_ENABLED: "false"
    }
  };
}

function sampleEligibleProposal(now = new Date()) {
  const expiry = new Date(now.getTime() + 15 * 60_000).toISOString();
  return createProposal({
    now,
    candidate: {
      symbol: "EUR/USD",
      direction: "BUY",
      timeframe: "M15",
      entryConditions: ["fast_sma_above_slow_sma"],
      referencePrice: { value: 1.085, source: "twelvedata" },
      stopLoss: { value: 1.083, pips: 20 },
      takeProfit: { value: 1.089, pips: 40 },
      rewardRisk: 2.0,
      strategy: { name: "baseline-trend-momentum-v1", version: "1.0.0" },
      reasons: ["trend_aligned"],
      expiry
    },
    riskEvaluation: {
      decision: "PASS",
      reasonCodes: [],
      engine: { version: "risk-baseline-v1" },
      positionSizing: { volume: 0.1, estimatedLossAtStop: 20 }
    }
  });
}

test("migration URL guard and SQL splitter support Supabase Session/Direct URLs and dollar-quoted blocks", () => {
  assert.equal(
    directDatabaseUrl({
      DIRECT_URL: "postgresql://postgres.ref:secret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require"
    }),
    "postgresql://postgres.ref:secret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require"
  );
  assert.equal(
    directDatabaseUrl({
      DIRECT_URL: "postgresql://postgres:secret@db.ref.supabase.co:5432/postgres?sslmode=require"
    }),
    "postgresql://postgres:secret@db.ref.supabase.co:5432/postgres?sslmode=require"
  );
  assert.throws(
    () =>
      directDatabaseUrl({
        DIRECT_URL: "postgresql://postgres.ref:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require"
      }),
    /transaction pooler/
  );
  assert.throws(
    () =>
      directDatabaseUrl({
        DIRECT_URL: "postgresql://user:secret@ep-example.us-east-2.aws.neon.tech/neondb?sslmode=require"
      }),
    /legacy Neon host/
  );

  const statements = splitSqlStatements(`
    ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
    DO $rls$
    BEGIN
      PERFORM 1;
      PERFORM 2;
    END
    $rls$;
    SELECT 'a;b''c' AS sample;
  `);
  assert.equal(statements.length, 3);
  assert.match(statements[1], /^DO \$rls\$[\s\S]*\$rls\$$/);
});

test("migrations 001-008 execute cleanly on disposable PostgreSQL and enforce RLS + PostgREST role lockdowns", async () => {
  const pg = new PGlite();
  try {
    // Simulate Supabase's PostgREST roles and default public schema privileges prior to running migrations.
    await pg.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      GRANT USAGE ON SCHEMA public TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
    `);

    const silentLogger = { log() {} };
    const firstRun = await runMigrations(pg, { logger: silentLogger });
    assert.deepEqual(firstRun.applied, ["000001", "000002", "000003", "000004", "000005", "000006", "000007", "000008"]);
    assert.deepEqual(firstRun.skipped, []);

    const secondRun = await runMigrations(pg, { logger: silentLogger });
    assert.deepEqual(secondRun.applied, []);
    assert.equal(secondRun.skipped.length, 8);

    // Every single application table in public must have Row Level Security enabled.
    const rlsCheck = await pg.query(
      `SELECT relname, relrowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
       ORDER BY relname ASC`
    );
    assert.equal(rlsCheck.rows.length, ALL_PUBLIC_TABLES.length);
    for (const row of rlsCheck.rows) {
      assert.equal(row.relrowsecurity, true, `Expected RLS enabled on ${row.relname}`);
    }

    // Seed owner and sensitive session/proposal rows via server owner role.
    await pg.query(
      "INSERT INTO app_users (id, username, password_hash) VALUES ($1, $2, $3)",
      [TEST_SUPABASE_OWNER_ID, TEST_OWNER_EMAIL, "supabase-auth-managed$external-password-disabled"]
    );
    await pg.query(
      "INSERT INTO auth_sessions (token_hash, user_id, csrf_token_hash, expires_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '30 minutes')",
      ["s".repeat(44), TEST_SUPABASE_OWNER_ID, "c".repeat(44)]
    );
    const proposal = sampleEligibleProposal();
    await pg.query(
      "INSERT INTO trade_proposals (id, user_id, version, status, content_digest, payload, expires_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)",
      [proposal.proposalId, TEST_SUPABASE_OWNER_ID, proposal.proposalVersion, proposal.status, proposal.contentDigest, JSON.stringify(proposal), proposal.immutableContent.expiresAt]
    );

    // Layer 1: PostgREST anon and authenticated roles have table privileges revoked by migration 008.
    await assert.rejects(
      async () => {
        await pg.exec("BEGIN; SET LOCAL ROLE anon; SELECT * FROM auth_sessions; COMMIT;");
      },
      /permission denied/i
    );
    await pg.exec("ROLLBACK").catch(() => {});

    await assert.rejects(
      async () => {
        await pg.exec("BEGIN; SET LOCAL ROLE authenticated; SELECT * FROM trade_proposals; COMMIT;");
      },
      /permission denied/i
    );
    await pg.exec("ROLLBACK").catch(() => {});

    // Layer 2 (defense in depth): even if SELECT were ever granted to anon/authenticated in the future,
    // restrictive RLS policies keep auth_sessions inaccessible and scope trade_proposals strictly to matching JWT sub.
    await pg.exec("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;");

    await pg.exec("BEGIN");
    await pg.exec("SET LOCAL ROLE anon");
    const anonSessions = await pg.query("SELECT * FROM auth_sessions");
    const anonProposals = await pg.query("SELECT * FROM trade_proposals");
    await pg.exec("COMMIT");
    assert.equal(anonSessions.rows.length, 0);
    assert.equal(anonProposals.rows.length, 0);

    // Non-owner authenticated JWT sees 0 proposals and 0 sessions.
    await pg.exec("BEGIN");
    await pg.exec("SET LOCAL ROLE authenticated");
    await pg.query("SELECT set_config('request.jwt.claim.sub', $1, true)", ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]);
    const otherUserProposals = await pg.query("SELECT * FROM trade_proposals");
    const authUserSessions = await pg.query("SELECT * FROM auth_sessions");
    await pg.exec("COMMIT");
    assert.equal(otherUserProposals.rows.length, 0);
    assert.equal(authUserSessions.rows.length, 0);

    // Matching owner JWT sub can read own proposal under defense-in-depth SELECT policy, still sees 0 auth_sessions, and cannot mutate rows.
    await pg.exec("BEGIN");
    await pg.exec("SET LOCAL ROLE authenticated");
    await pg.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [TEST_SUPABASE_OWNER_ID]);
    const ownerProposals = await pg.query("SELECT id FROM trade_proposals");
    const ownerSessions = await pg.query("SELECT * FROM auth_sessions");
    assert.equal(ownerProposals.rows.length, 1);
    assert.equal(ownerSessions.rows.length, 0);
    await assert.rejects(
      () => pg.query("DELETE FROM trade_proposals WHERE id = $1", [proposal.proposalId]),
      // Either 0 rows deleted under RLS or permission error; verify below that row remains intact.
      () => true
    ).catch(() => {});
    await pg.exec("COMMIT");

    const stillPresent = await pg.query("SELECT COUNT(*)::integer AS count FROM trade_proposals");
    assert.equal(stillPresent.rows[0].count, 1);
  } finally {
    await pg.close();
  }
});

test("real PostgreSQL backs owner login, concurrent user deduplication, transactions, rate limits, risk state, and proposal approvals", async () => {
  const pg = new PGlite();
  try {
    await runMigrations(pg, { logger: { log() {} } });
    const db = createPgliteDatabaseClient(pg);
    setDatabaseForTests(db);
    clearAuthState();

    const fakeSupabase = createFakeSupabaseFetch();
    setSupabaseFetchForTests(fakeSupabase);

    // 1. Five concurrent owner logins against real PostgreSQL create exactly 1 app_users row and 5 sessions.
    const concurrentResponses = await Promise.all(
      Array.from({ length: 5 }, (_, index) => {
        const res = responseDouble();
        return loginHandler(
          makeRequest({
            url: "http://localhost:3000/api/auth/login",
            method: "POST",
            ip: `198.51.100.${50 + index}`,
            body: { email: TEST_OWNER_EMAIL, password: TEST_OWNER_PASSWORD }
          }),
          res
        ).then(() => res);
      })
    );
    for (const res of concurrentResponses) {
      assert.equal(res.statusCode, 200);
    }
    const usersCount = await db.query("SELECT COUNT(*)::integer AS count FROM app_users");
    assert.equal(usersCount.rows[0].count, 1);

    // Non-owner Supabase user login against real PostgreSQL receives 403, creates 0 app_users rows, and records auth.access.denied.
    const intruderRes = responseDouble();
    await loginHandler(
      makeRequest({
        url: "http://localhost:3000/api/auth/login",
        method: "POST",
        ip: "198.51.100.99",
        body: { email: "intruder@example.test", password: "intruder-valid-password" }
      }),
      intruderRes
    );
    assert.equal(intruderRes.statusCode, 403);
    assert.equal((await db.query("SELECT COUNT(*)::integer AS count FROM app_users")).rows[0].count, 1);
    const deniedAudits = await db.query("SELECT COUNT(*)::integer AS count FROM audit_events WHERE event_type = 'auth.access.denied'");
    assert.equal(deniedAudits.rows[0].count, 1);

    const activeCookie = cookieFrom(concurrentResponses[0]);
    const csrfToken = concurrentResponses[0].body.csrfToken;

    // 2. Session verification + operations health probe ("SELECT 1") against real PostgreSQL.
    const meRes = responseDouble();
    await meHandler(makeRequest({ cookie: activeCookie }), meRes);
    assert.equal(meRes.statusCode, 200);
    assert.equal(meRes.body.user.username, TEST_OWNER_EMAIL);

    const opsRes = responseDouble();
    await operationsHandler(makeRequest({ url: "http://localhost:3000/api/private/operations", cookie: activeCookie }), opsRes);
    assert.equal(opsRes.body.services.database.state, "healthy");

    // 3. Shared PostgreSQL rate_limit_buckets atomic upsert and enforcement.
    const r1 = await consumeRateLimit(db, { key: "pg:test:bucket", windowSeconds: 120, maxRequests: 2 });
    const r2 = await consumeRateLimit(db, { key: "pg:test:bucket", windowSeconds: 120, maxRequests: 2 });
    const r3 = await consumeRateLimit(db, { key: "pg:test:bucket", windowSeconds: 120, maxRequests: 2 });
    assert.equal(r1.allowed, true);
    assert.equal(r2.allowed, true);
    assert.equal(r3.allowed, false);
    assert.ok(r3.retryAfterSeconds > 0);

    // 4. Risk configuration partial unique index (only 1 active configuration allowed) + risk evaluation FK integrity.
    await db.query(
      "INSERT INTO risk_configurations (version, configuration, active) VALUES ($1, $2::jsonb, TRUE)",
      ["risk-baseline-v1", JSON.stringify({ maxEquityRiskFraction: 0.0025 })]
    );
    await assert.rejects(
      () =>
        db.query(
          "INSERT INTO risk_configurations (version, configuration, active) VALUES ($1, $2::jsonb, TRUE)",
          ["risk-baseline-v2", JSON.stringify({ maxEquityRiskFraction: 0.005 })]
        ),
      DatabaseQueryError
    );
    const loadedRiskConfig = await loadRiskConfiguration(db, "risk-baseline-v1");
    assert.equal(loadedRiskConfig.version, "risk-baseline-v1");
    const recordedRisk = await recordRiskEvaluation(db, {
      userId: TEST_SUPABASE_OWNER_ID,
      candidateId: "cand_01",
      decision: "BLOCKED",
      reasonCodes: ["account_state_unavailable"],
      inputs: { symbol: "EUR/USD" },
      configurationVersion: "risk-baseline-v1"
    });
    assert.ok(recordedRisk.id);

    // 5. Immutable proposal persistence and CSRF-protected atomic approval transition via proposals handler.
    const proposal = sampleEligibleProposal();
    await insertProposal(db, { userId: TEST_SUPABASE_OWNER_ID, proposal });

    const approveRes = responseDouble();
    await proposalsHandler(
      makeRequest({
        url: "http://localhost:3000/api/private/proposals",
        method: "POST",
        cookie: activeCookie,
        csrf: csrfToken,
        body: {
          action: "approve",
          proposalId: proposal.proposalId,
          proposalVersion: proposal.proposalVersion,
          contentDigest: proposal.contentDigest
        }
      }),
      approveRes
    );
    assert.equal(approveRes.statusCode, 200);
    assert.equal(approveRes.body.decision, "approved");
    assert.equal(approveRes.body.executionAllowed, false);

    const decisionRows = await db.query(
      "SELECT decision, actor_user_id, content_digest FROM trade_proposal_decisions WHERE proposal_id = $1",
      [proposal.proposalId]
    );
    assert.equal(decisionRows.rows.length, 1);
    assert.equal(decisionRows.rows[0].actor_user_id, TEST_SUPABASE_OWNER_ID);

    // 6. Explicit database.transaction() commit and rollback atomicity in real PostgreSQL.
    await db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO audit_events (id, user_id, event_type, metadata) VALUES ($1, $2, $3, $4::jsonb)",
        [`audit_${randomUUID()}`, TEST_SUPABASE_OWNER_ID, "tx.committed", JSON.stringify({ step: 1 })]
      );
    });
    const committedAudit = await db.query("SELECT COUNT(*)::integer AS count FROM audit_events WHERE event_type = 'tx.committed'");
    assert.equal(committedAudit.rows[0].count, 1);

    await assert.rejects(
      () =>
        db.transaction(async (tx) => {
          await tx.query(
            "INSERT INTO audit_events (id, user_id, event_type, metadata) VALUES ($1, $2, $3, $4::jsonb)",
            [`audit_${randomUUID()}`, TEST_SUPABASE_OWNER_ID, "tx.rolled_back", JSON.stringify({ step: 1 })]
          );
          // Trigger real PostgreSQL CHECK constraint failure (id shorter than 20 chars)
          await tx.query(
            "INSERT INTO audit_events (id, user_id, event_type, metadata) VALUES ($1, $2, $3, $4::jsonb)",
            ["too_short", TEST_SUPABASE_OWNER_ID, "tx.invalid", "{}"]
          );
        }),
      DatabaseQueryError
    );
    const rolledBackAudit = await db.query("SELECT COUNT(*)::integer AS count FROM audit_events WHERE event_type = 'tx.rolled_back'");
    assert.equal(rolledBackAudit.rows[0].count, 0);

    // 7. Logout revokes session in real PostgreSQL and invalidates subsequent /api/auth/me calls.
    const logoutRes = responseDouble();
    await logoutHandler(
      makeRequest({
        url: "http://localhost:3000/api/auth/logout",
        method: "POST",
        cookie: activeCookie,
        csrf: csrfToken
      }),
      logoutRes
    );
    assert.equal(logoutRes.statusCode, 200);

    const afterLogout = responseDouble();
    await meHandler(makeRequest({ cookie: activeCookie }), afterLogout);
    assert.equal(afterLogout.statusCode, 401);
  } finally {
    clearAuthState();
    clearDatabaseTestOverride();
    await pg.close();
  }
});

test("Neon-to-Supabase data migration preserves durable records, remaps legacy owner UUID, is idempotent, and leaves Neon untouched", async () => {
  const neonSource = new PGlite();
  const supabaseTarget = new PGlite();

  try {
    // Apply migrations 001..006 on simulated Neon source (matching documented Neon branch state).
    await neonSource.query(
      "CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    );
    for (const file of [
      "001_initial_schema.sql",
      "002_risk_engine.sql",
      "003_trade_proposals.sql",
      "004_paper_backtest.sql",
      "005_execution_reconciliation.sql",
      "006_operations.sql"
    ]) {
      const sql = await readFile(new URL(`../db/migrations/${file}`, import.meta.url), "utf8");
      await neonSource.exec(sql);
      await neonSource.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file.slice(0, 3).padStart(6, "0")]);
    }

    // Apply all migrations 001..008 on simulated Supabase target.
    await runMigrations(supabaseTarget, { logger: { log() {} } });

    const legacyNeonUserId = "99999999-8888-4777-8666-555555555555";
    await neonSource.query(
      "INSERT INTO app_users (id, username, password_hash) VALUES ($1, $2, $3)",
      [legacyNeonUserId, "legacy-operator", "scrypt$16384$8$1$legacyplaceholderhashvalue000000000000"]
    );
    // Ephemeral session & worker lease on Neon (must NOT be copied to Supabase)
    await neonSource.query(
      "INSERT INTO auth_sessions (token_hash, user_id, csrf_token_hash, expires_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '20 minutes')",
      ["t".repeat(44), legacyNeonUserId, "h".repeat(44)]
    );
    await neonSource.query(
      "INSERT INTO worker_leases (worker_id, status, heartbeat_at, lease_until) VALUES ('legacy-worker', 'stopped', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
    );

    // Durable records across domain tables on Neon
    await neonSource.query(
      "INSERT INTO risk_configurations (version, configuration, active) VALUES ('risk-baseline-v1', '{\"maxOpenPositions\":2}'::jsonb, TRUE)"
    );
    await neonSource.query(
      "INSERT INTO risk_daily_state (trading_day_key, time_zone, account_currency, daily_start_equity, realized_pnl, loss_streak, source, captured_at) VALUES ('2026-10-25', 'UTC', 'USD', 10000, 0, 0, 'fixture', CURRENT_TIMESTAMP)"
    );
    await neonSource.query(
      "INSERT INTO risk_account_snapshots (id, account_currency, equity, unrealized_pnl, source, is_simulated, captured_at) VALUES ($1, 'USD', 10000, 0, 'fixture', true, CURRENT_TIMESTAMP)",
      [`acct_${randomUUID()}`]
    );
    await neonSource.query(
      "INSERT INTO audit_events (id, user_id, event_type, metadata) VALUES ($1, $2, 'auth.login.succeeded', '{\"legacy\":true}'::jsonb), ($3, NULL, 'system.startup', '{}'::jsonb)",
      [`audit_${randomUUID()}`, legacyNeonUserId, `audit_${randomUUID()}`]
    );
    await neonSource.query(
      "INSERT INTO risk_evaluations (id, user_id, candidate_id, decision, reason_codes, inputs, configuration_version) VALUES ($1, $2, 'cand_legacy', 'PASS', '[]'::jsonb, '{\"symbol\":\"EUR/USD\"}'::jsonb, 'risk-baseline-v1')",
      [`risk_${randomUUID()}`, legacyNeonUserId]
    );

    const migratedProposal = sampleEligibleProposal();
    await neonSource.query(
      "INSERT INTO trade_proposals (id, user_id, version, status, content_digest, payload, expires_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)",
      [
        migratedProposal.proposalId,
        legacyNeonUserId,
        migratedProposal.proposalVersion,
        migratedProposal.status,
        migratedProposal.contentDigest,
        JSON.stringify(migratedProposal),
        migratedProposal.immutableContent.expiresAt
      ]
    );
    await neonSource.query(
      "INSERT INTO backtest_runs (id, user_id, status, configuration, results) VALUES ($1, $2, 'completed', '{\"symbol\":\"EUR/USD\"}'::jsonb, '{\"trades\":0}'::jsonb)",
      [`bt_${randomUUID()}`, legacyNeonUserId]
    );
    const paperPositionId = `ppos_${randomUUID()}`;
    await neonSource.query(
      "INSERT INTO paper_positions (id, user_id, proposal_id, proposal_version, symbol, direction, entry_price, stop_loss, take_profit, status, opened_at, closed_at) VALUES ($1, $2, $3, 1, 'EUR/USD', 'BUY', 1.085, 1.083, 1.089, 'closed', CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP)",
      [paperPositionId, legacyNeonUserId, migratedProposal.proposalId]
    );
    await neonSource.query(
      "INSERT INTO paper_trades (id, position_id, user_id, gross_pnl, estimated_costs, net_pnl, opened_at, closed_at) VALUES ($1, $2, $3, 40, 2, 38, CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP)",
      [`ptrd_${randomUUID()}`, paperPositionId, legacyNeonUserId]
    );
    const executionId = `exec_${randomUUID()}`;
    await neonSource.query(
      "INSERT INTO execution_intents (id, user_id, proposal_id, proposal_version, content_digest, idempotency_key, state) VALUES ($1, $2, $3, 1, $4, $5, 'reconciliation_required')",
      [executionId, legacyNeonUserId, migratedProposal.proposalId, migratedProposal.contentDigest, `idem_${randomUUID()}`]
    );
    await neonSource.query(
      "INSERT INTO execution_transitions (id, execution_id, from_state, to_state, metadata) VALUES ($1, $2, 'submission_unknown', 'reconciliation_required', '{}'::jsonb)",
      [`extr_${randomUUID()}`, executionId]
    );
    await neonSource.query(
      "INSERT INTO operational_alerts (id, alert_key, event_type, severity, message) VALUES ($1, 'reconciliation.backlog', 'reconciliation.backlog', 'warning', 'Legacy alert preserved')",
      [`alrt_${randomUUID()}`]
    );
    await neonSource.query(
      "INSERT INTO recovery_tasks (id, task_type, idempotency_key, state, payload) VALUES ($1, 'reconcile_intent', $2, 'reconciliation_required', '{}'::jsonb)",
      [`task_${randomUUID()}`, `task_idem_${randomUUID()}`]
    );

    // 1. Dry-run performs zero writes on target and zero modifications on Neon source.
    const dryRun = await migrateNeonToSupabase({
      sourceClient: neonSource,
      targetClient: supabaseTarget,
      ownerUserId: TEST_SUPABASE_OWNER_ID,
      ownerEmail: TEST_OWNER_EMAIL,
      execute: false
    });
    assert.equal(dryRun.mode, "dry_run");
    assert.equal(dryRun.legacyUserRemapped, true);
    assert.equal((await supabaseTarget.query("SELECT COUNT(*)::integer AS count FROM app_users")).rows[0].count, 0);

    // 2. Execute performs atomic migration, remaps legacy owner UUID -> SUPABASE_OWNER_USER_ID, and skips ephemeral tables.
    const firstExec = await migrateNeonToSupabase({
      sourceClient: neonSource,
      targetClient: supabaseTarget,
      ownerUserId: TEST_SUPABASE_OWNER_ID,
      ownerEmail: TEST_OWNER_EMAIL,
      execute: true
    });
    assert.equal(firstExec.mode, "executed");
    assert.equal(firstExec.ownerCreated, true);
    assert.equal(firstExec.legacyUserRemapped, true);

    const targetUsers = await supabaseTarget.query("SELECT id, username FROM app_users");
    assert.equal(targetUsers.rows.length, 1);
    assert.equal(targetUsers.rows[0].id, TEST_SUPABASE_OWNER_ID);
    assert.equal(targetUsers.rows[0].username, TEST_OWNER_EMAIL);

    // Ephemeral tables were NOT copied
    assert.equal((await supabaseTarget.query("SELECT COUNT(*)::integer AS count FROM auth_sessions")).rows[0].count, 0);
    assert.equal((await supabaseTarget.query("SELECT COUNT(*)::integer AS count FROM worker_leases")).rows[0].count, 0);

    // Durable records are present and owned by SUPABASE_OWNER_USER_ID (with NULL system audit events preserved as NULL)
    const targetAudits = await supabaseTarget.query("SELECT user_id, event_type FROM audit_events ORDER BY event_type ASC");
    assert.equal(targetAudits.rows.length, 2);
    assert.equal(targetAudits.rows[0].user_id, TEST_SUPABASE_OWNER_ID);
    assert.equal(targetAudits.rows[1].user_id, null);

    const targetProposals = await supabaseTarget.query("SELECT id, user_id, content_digest FROM trade_proposals");
    assert.equal(targetProposals.rows.length, 1);
    assert.equal(targetProposals.rows[0].user_id, TEST_SUPABASE_OWNER_ID);
    assert.equal(targetProposals.rows[0].content_digest, migratedProposal.contentDigest);

    assert.equal((await supabaseTarget.query("SELECT COUNT(*)::integer AS count FROM paper_trades")).rows[0].count, 1);
    assert.equal((await supabaseTarget.query("SELECT COUNT(*)::integer AS count FROM execution_transitions")).rows[0].count, 1);
    assert.equal((await supabaseTarget.query("SELECT COUNT(*)::integer AS count FROM operational_alerts")).rows[0].count, 1);
    assert.equal((await supabaseTarget.query("SELECT COUNT(*)::integer AS count FROM recovery_tasks")).rows[0].count, 1);

    // 3. Re-running migration is 100% idempotent (0 newly inserted rows, 0 duplicates).
    const secondExec = await migrateNeonToSupabase({
      sourceClient: neonSource,
      targetClient: supabaseTarget,
      ownerUserId: TEST_SUPABASE_OWNER_ID,
      ownerEmail: TEST_OWNER_EMAIL,
      execute: true
    });
    for (const summary of secondExec.tables) {
      assert.equal(summary.insertedRows, 0, `Expected 0 duplicate inserts on ${summary.table}`);
    }

    // 4. Neon source database remains 100% untouched.
    const neonUsers = await neonSource.query("SELECT id, username FROM app_users");
    assert.equal(neonUsers.rows.length, 1);
    assert.equal(neonUsers.rows[0].id, legacyNeonUserId);
    assert.equal((await neonSource.query("SELECT COUNT(*)::integer AS count FROM auth_sessions")).rows[0].count, 1);

    // 5. Env guard rejects Neon target URLs and transaction-pooled target URLs.
    assert.throws(
      () =>
        validateDataMigrationEnv({
          NEON_SOURCE_DATABASE_URL: "postgresql://u:p@ep-example.us-east-2.aws.neon.tech/neondb",
          SUPABASE_TARGET_DIRECT_URL: "postgresql://u:p@ep-other.us-east-2.aws.neon.tech/neondb",
          SUPABASE_OWNER_USER_ID: TEST_SUPABASE_OWNER_ID
        }),
      /Neon host/
    );
    assert.throws(
      () =>
        validateDataMigrationEnv({
          NEON_SOURCE_DATABASE_URL: "postgresql://u:p@ep-example.us-east-2.aws.neon.tech/neondb",
          SUPABASE_TARGET_DIRECT_URL: "postgresql://postgres.ref:p@aws-0-eu-west-1.pooler.supabase.com:6543/postgres",
          SUPABASE_OWNER_USER_ID: TEST_SUPABASE_OWNER_ID
        }),
      /Transaction Mode/
    );
  } finally {
    await neonSource.close();
    await supabaseTarget.close();
  }
});
