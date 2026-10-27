import { pathToFileURL } from "node:url";
import pg from "pg";
import { buildPgClientConfig } from "../api/_lib/database.js";
import { isLegacyNeonDatabaseUrl, isTransactionPooledDatabaseUrl } from "../api/_lib/deployment.js";
import { supabaseFallbackUsername } from "../api/_lib/repository.js";

const { Client } = pg;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPABASE_MANAGED_PASSWORD_HASH = "supabase-auth-managed$external-password-disabled";
const REQUIRED_TARGET_MIGRATIONS = Object.freeze([
  "000001",
  "000002",
  "000003",
  "000004",
  "000005",
  "000006",
  "000007",
  "000008"
]);

export const EXCLUDED_EPHEMERAL_TABLES = Object.freeze([
  "schema_migrations",
  "auth_sessions",
  "worker_leases",
  "rate_limit_buckets"
]);

export const DURABLE_MIGRATION_TABLES = Object.freeze([
  {
    table: "risk_configurations",
    columns: ["version", "configuration", "active", "created_at"],
    jsonbColumns: ["configuration"],
    conflictTarget: "(version)",
    orderBy: "created_at ASC, version ASC"
  },
  {
    table: "risk_daily_state",
    columns: [
      "trading_day_key",
      "time_zone",
      "account_currency",
      "daily_start_equity",
      "realized_pnl",
      "loss_streak",
      "cooling_until",
      "source",
      "captured_at",
      "updated_at"
    ],
    jsonbColumns: [],
    conflictTarget: "(trading_day_key)",
    orderBy: "trading_day_key ASC"
  },
  {
    table: "risk_account_snapshots",
    columns: ["id", "account_currency", "equity", "unrealized_pnl", "source", "is_simulated", "captured_at"],
    jsonbColumns: [],
    conflictTarget: "(id)",
    orderBy: "captured_at ASC, id ASC"
  },
  {
    table: "risk_position_snapshots",
    columns: ["id", "symbol", "direction", "volume", "exposure", "correlation_group", "source", "captured_at"],
    jsonbColumns: [],
    conflictTarget: "(id)",
    orderBy: "captured_at ASC, id ASC"
  },
  {
    table: "audit_events",
    columns: ["id", "user_id", "event_type", "metadata", "created_at"],
    jsonbColumns: ["metadata"],
    ownerColumn: "user_id",
    nullableOwner: true,
    conflictTarget: "(id)",
    orderBy: "created_at ASC, id ASC"
  },
  {
    table: "risk_evaluations",
    columns: ["id", "user_id", "candidate_id", "decision", "reason_codes", "inputs", "configuration_version", "created_at"],
    jsonbColumns: ["reason_codes", "inputs"],
    ownerColumn: "user_id",
    nullableOwner: true,
    conflictTarget: "(id)",
    orderBy: "created_at ASC, id ASC"
  },
  {
    table: "trade_proposals",
    columns: ["id", "user_id", "version", "status", "content_digest", "payload", "expires_at", "created_at", "updated_at"],
    jsonbColumns: ["payload"],
    ownerColumn: "user_id",
    nullableOwner: false,
    conflictTarget: "(id, version)",
    orderBy: "created_at ASC, id ASC, version ASC"
  },
  {
    table: "trade_proposal_decisions",
    columns: ["id", "proposal_id", "proposal_version", "actor_user_id", "decision", "reason", "content_digest", "created_at"],
    jsonbColumns: [],
    ownerColumn: "actor_user_id",
    nullableOwner: false,
    conflictTarget: "(id)",
    orderBy: "created_at ASC, id ASC"
  },
  {
    table: "backtest_runs",
    columns: ["id", "user_id", "status", "configuration", "results", "created_at", "completed_at"],
    jsonbColumns: ["configuration", "results"],
    ownerColumn: "user_id",
    nullableOwner: false,
    conflictTarget: "(id)",
    orderBy: "created_at ASC, id ASC"
  },
  {
    table: "paper_events",
    columns: ["event_id", "user_id", "status", "payload", "created_at"],
    jsonbColumns: ["payload"],
    ownerColumn: "user_id",
    nullableOwner: false,
    conflictTarget: "(event_id)",
    orderBy: "created_at ASC, event_id ASC"
  },
  {
    table: "paper_positions",
    columns: [
      "id",
      "user_id",
      "proposal_id",
      "proposal_version",
      "symbol",
      "direction",
      "entry_price",
      "stop_loss",
      "take_profit",
      "status",
      "simulated",
      "opened_at",
      "closed_at"
    ],
    jsonbColumns: [],
    ownerColumn: "user_id",
    nullableOwner: false,
    conflictTarget: "(id)",
    orderBy: "opened_at ASC, id ASC"
  },
  {
    table: "paper_trades",
    columns: ["id", "position_id", "user_id", "gross_pnl", "estimated_costs", "net_pnl", "simulated", "opened_at", "closed_at"],
    jsonbColumns: [],
    ownerColumn: "user_id",
    nullableOwner: false,
    conflictTarget: "(id)",
    orderBy: "closed_at ASC, id ASC"
  },
  {
    table: "execution_intents",
    columns: [
      "id",
      "user_id",
      "proposal_id",
      "proposal_version",
      "content_digest",
      "idempotency_key",
      "state",
      "broker_order_id",
      "broker_deal_ids",
      "discrepancy",
      "created_at",
      "updated_at"
    ],
    jsonbColumns: ["broker_deal_ids"],
    ownerColumn: "user_id",
    nullableOwner: false,
    conflictTarget: "(id)",
    orderBy: "created_at ASC, id ASC"
  },
  {
    table: "execution_transitions",
    columns: ["id", "execution_id", "from_state", "to_state", "metadata", "created_at"],
    jsonbColumns: ["metadata"],
    conflictTarget: "(id)",
    orderBy: "created_at ASC, id ASC"
  },
  {
    table: "operational_alerts",
    columns: [
      "id",
      "alert_key",
      "event_type",
      "severity",
      "message",
      "delivery_status",
      "occurrence_count",
      "metadata",
      "first_seen_at",
      "last_seen_at",
      "next_allowed_at",
      "acknowledged_at"
    ],
    jsonbColumns: ["metadata"],
    conflictTarget: "(id)",
    orderBy: "first_seen_at ASC, id ASC"
  },
  {
    table: "recovery_tasks",
    columns: [
      "id",
      "task_type",
      "idempotency_key",
      "state",
      "attempt_count",
      "available_at",
      "lease_until",
      "last_error",
      "payload",
      "created_at",
      "updated_at"
    ],
    jsonbColumns: ["payload"],
    conflictTarget: "(id)",
    orderBy: "created_at ASC, id ASC"
  }
]);

async function relationExists(client, tableName) {
  const result = await client.query("SELECT to_regclass($1) IS NOT NULL AS present", [`public.${tableName}`]);
  return Boolean(result.rows[0]?.present);
}

function serializeColumnValue(value, isJsonb) {
  if (value === null || value === undefined) return null;
  if (isJsonb) {
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  return value;
}

function remapOwnerReference(rawValue, legacyUserId, ownerUserId, nullableOwner) {
  if (rawValue === null || rawValue === undefined) {
    if (nullableOwner) return null;
    throw new Error("Encountered NULL owner reference on a non-nullable user-owned record");
  }
  const normalized = String(rawValue);
  if (normalized.toLowerCase() === ownerUserId || (legacyUserId && normalized === legacyUserId)) {
    return ownerUserId;
  }
  throw new Error("Encountered record owned by an unexpected user ID during single-owner migration");
}

export async function migrateNeonToSupabase({
  sourceClient,
  targetClient,
  ownerUserId,
  ownerEmail = "",
  execute = false
}) {
  if (!sourceClient || !targetClient) {
    throw new Error("Both sourceClient and targetClient are required");
  }
  if (typeof ownerUserId !== "string" || !UUID_PATTERN.test(ownerUserId.trim())) {
    throw new Error("SUPABASE_OWNER_USER_ID must be a valid UUID");
  }
  const canonicalOwnerId = ownerUserId.trim().toLowerCase();
  const normalizedEmail = typeof ownerEmail === "string" ? ownerEmail.trim().toLowerCase() : "";

  if (!(await relationExists(targetClient, "schema_migrations"))) {
    throw new Error("Target Supabase database is missing schema_migrations; run migrations 001-008 first");
  }
  const targetMigrationsResult = await targetClient.query("SELECT version FROM schema_migrations ORDER BY version ASC");
  const appliedTargetVersions = new Set(targetMigrationsResult.rows.map((row) => row.version));
  const missingVersions = REQUIRED_TARGET_MIGRATIONS.filter((version) => !appliedTargetVersions.has(version));
  if (missingVersions.length > 0) {
    throw new Error(`Target Supabase database is missing required migrations: ${missingVersions.join(", ")}`);
  }

  // Enforce engine-level read-only isolation on the Neon source database.
  await sourceClient.query("BEGIN READ ONLY");
  try {
    const sourceHasUsers = await relationExists(sourceClient, "app_users");
    const sourceUsers = sourceHasUsers
      ? (await sourceClient.query("SELECT id, username, created_at, updated_at FROM app_users ORDER BY created_at ASC")).rows
      : [];

    if (sourceUsers.length > 1) {
      throw new Error(`Source app_users contains ${sourceUsers.length} users; single-owner migration refuses automatic multi-user merge`);
    }

    const legacyUser = sourceUsers[0] || null;
    const legacyUserId = legacyUser?.id || null;
    const preferredUsername =
      (normalizedEmail.length >= 3 && normalizedEmail.length <= 64 && normalizedEmail) ||
      (legacyUser?.username && legacyUser.username.length >= 3 && legacyUser.username.length <= 64 && legacyUser.username) ||
      supabaseFallbackUsername(canonicalOwnerId);

    const tableSummaries = [];

    if (!execute) {
      for (const spec of DURABLE_MIGRATION_TABLES) {
        const present = await relationExists(sourceClient, spec.table);
        const count = present
          ? Number((await sourceClient.query(`SELECT COUNT(*)::integer AS count FROM ${spec.table}`)).rows[0]?.count || 0)
          : 0;
        tableSummaries.push({
          table: spec.table,
          presentInSource: present,
          sourceRows: count,
          insertedRows: 0,
          skippedExistingRows: 0
        });
      }

      return Object.freeze({
        mode: "dry_run",
        ownerUserId: canonicalOwnerId,
        legacyUserRemapped: Boolean(legacyUserId && legacyUserId !== canonicalOwnerId),
        sourceUserCount: sourceUsers.length,
        excludedTables: EXCLUDED_EPHEMERAL_TABLES,
        tables: Object.freeze(tableSummaries)
      });
    }

    await targetClient.query("BEGIN");
    try {
      const existingTargetOwner = await targetClient.query("SELECT id, username FROM app_users WHERE id = $1", [canonicalOwnerId]);
      let ownerCreated = false;
      if (!existingTargetOwner.rows[0]) {
        const candidateUsernames = preferredUsername === supabaseFallbackUsername(canonicalOwnerId)
          ? [preferredUsername]
          : [preferredUsername, supabaseFallbackUsername(canonicalOwnerId)];
        for (const candidateUsername of candidateUsernames) {
          const insertedOwner = await targetClient.query(
            `INSERT INTO app_users (id, username, password_hash, created_at, updated_at)
             VALUES ($1, $2, $3, COALESCE($4::timestamptz, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [canonicalOwnerId, candidateUsername, SUPABASE_MANAGED_PASSWORD_HASH, legacyUser?.created_at || null]
          );
          if (insertedOwner.rows[0]) {
            ownerCreated = true;
            break;
          }
        }
      }

      const verifiedOwner = await targetClient.query("SELECT id FROM app_users WHERE id = $1", [canonicalOwnerId]);
      if (!verifiedOwner.rows[0]) {
        throw new Error("Failed to establish canonical owner row in target app_users");
      }

      for (const spec of DURABLE_MIGRATION_TABLES) {
        const present = await relationExists(sourceClient, spec.table);
        if (!present) {
          tableSummaries.push({
            table: spec.table,
            presentInSource: false,
            sourceRows: 0,
            insertedRows: 0,
            skippedExistingRows: 0
          });
          continue;
        }

        const selectSql = `SELECT ${spec.columns.join(", ")} FROM ${spec.table} ORDER BY ${spec.orderBy}`;
        const sourceRows = (await sourceClient.query(selectSql)).rows;
        let insertedRows = 0;

        for (const row of sourceRows) {
          const values = spec.columns.map((column) => {
            const raw = row[column];
            const mapped = spec.ownerColumn === column
              ? remapOwnerReference(raw, legacyUserId, canonicalOwnerId, Boolean(spec.nullableOwner))
              : raw;
            return serializeColumnValue(mapped, spec.jsonbColumns.includes(column));
          });

          const placeholders = spec.columns.map((column, index) => {
            const param = `$${index + 1}`;
            return spec.jsonbColumns.includes(column) ? `${param}::jsonb` : param;
          });

          const insertResult = await targetClient.query(
            `INSERT INTO ${spec.table} (${spec.columns.join(", ")})
             VALUES (${placeholders.join(", ")})
             ON CONFLICT ${spec.conflictTarget} DO NOTHING`,
            values
          );
          insertedRows += insertResult.rowCount || 0;
        }

        const targetCount = Number(
          (await targetClient.query(`SELECT COUNT(*)::integer AS count FROM ${spec.table}`)).rows[0]?.count || 0
        );
        if (targetCount < sourceRows.length) {
          throw new Error(`Post-copy row count mismatch on ${spec.table}: expected at least ${sourceRows.length}, found ${targetCount}`);
        }

        tableSummaries.push({
          table: spec.table,
          presentInSource: true,
          sourceRows: sourceRows.length,
          insertedRows,
          skippedExistingRows: sourceRows.length - insertedRows
        });
      }

      await targetClient.query("COMMIT");
      return Object.freeze({
        mode: "executed",
        ownerUserId: canonicalOwnerId,
        ownerCreated,
        legacyUserRemapped: Boolean(legacyUserId && legacyUserId !== canonicalOwnerId),
        sourceUserCount: sourceUsers.length,
        excludedTables: EXCLUDED_EPHEMERAL_TABLES,
        tables: Object.freeze(tableSummaries)
      });
    } catch (error) {
      await targetClient.query("ROLLBACK").catch(() => {});
      throw error;
    }
  } finally {
    await sourceClient.query("ROLLBACK").catch(() => {});
  }
}

export function validateDataMigrationEnv(env = process.env) {
  const sourceUrl = (env.NEON_SOURCE_DATABASE_URL || "").trim();
  const targetUrl = (env.SUPABASE_TARGET_DIRECT_URL || env.DIRECT_URL || "").trim();
  const ownerUserId = (env.SUPABASE_OWNER_USER_ID || "").trim();

  if (!sourceUrl) throw new Error("NEON_SOURCE_DATABASE_URL is required");
  if (!targetUrl) throw new Error("SUPABASE_TARGET_DIRECT_URL (or DIRECT_URL) is required");
  if (sourceUrl === targetUrl) throw new Error("Source and target database URLs must not be identical");
  if (isLegacyNeonDatabaseUrl(targetUrl)) {
    throw new Error("Target URL points to a Neon host; SUPABASE_TARGET_DIRECT_URL must point to Supabase PostgreSQL");
  }
  if (isTransactionPooledDatabaseUrl(targetUrl)) {
    throw new Error("Target URL must use Supabase Session Mode (:5432) or Direct (:5432), not Transaction Mode (:6543)");
  }
  if (!UUID_PATTERN.test(ownerUserId)) {
    throw new Error("SUPABASE_OWNER_USER_ID must be a valid UUID");
  }

  return { sourceUrl, targetUrl, ownerUserId: ownerUserId.toLowerCase(), ownerEmail: (env.SUPABASE_OWNER_EMAIL || "").trim() };
}

async function main() {
  const execute = process.argv.includes("--execute");
  const { sourceUrl, targetUrl, ownerUserId, ownerEmail } = validateDataMigrationEnv(process.env);

  const sourceClient = new Client(buildPgClientConfig(sourceUrl, { queryTimeoutMs: 30_000 }));
  const targetClient = new Client(buildPgClientConfig(targetUrl, { queryTimeoutMs: 30_000 }));

  await sourceClient.connect();
  await targetClient.connect();
  try {
    const summary = await migrateNeonToSupabase({
      sourceClient,
      targetClient,
      ownerUserId,
      ownerEmail,
      execute
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await sourceClient.end().catch(() => {});
    await targetClient.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
