import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { buildPgClientConfig } from "../api/_lib/database.js";
import { isLegacyNeonDatabaseUrl, isTransactionPooledDatabaseUrl } from "../api/_lib/deployment.js";

const { Client } = pg;

export function migrationVersion(fileName) {
  const match = /^(\d+)_.*\.sql$/.exec(fileName);
  if (!match) throw new Error(`Migration filename must start with a numeric version: ${fileName}`);
  return match[1].padStart(6, "0");
}

export function directDatabaseUrl(env = process.env) {
  const direct = (env.DIRECT_URL || "").trim();
  const unpooled = (env.DATABASE_URL_UNPOOLED || "").trim();
  if (direct && unpooled && direct !== unpooled) {
    throw new Error("DIRECT_URL and DATABASE_URL_UNPOOLED must match when both are configured");
  }
  const url = direct || unpooled || (env.DATABASE_URL || "").trim();
  if (!url) throw new Error("DIRECT_URL, DATABASE_URL_UNPOOLED, or a session/direct DATABASE_URL is required");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Migration database URL must be a valid PostgreSQL connection URL");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || !parsed.username) {
    throw new Error("Migration database URL must be a valid PostgreSQL connection URL");
  }
  if (isLegacyNeonDatabaseUrl(url)) {
    throw new Error("Migration URL points to a legacy Neon host; configure your Supabase Session Mode (:5432) or Direct (:5432) PostgreSQL URL");
  }
  if (isTransactionPooledDatabaseUrl(url)) {
    throw new Error("Migrations require a Supabase Session Mode (:5432) or Direct (:5432) PostgreSQL connection URL, not a transaction pooler (:6543)");
  }
  return url;
}

function matchDollarQuoteTag(source, index) {
  if (source[index] !== "$") return null;
  let cursor = index + 1;
  while (cursor < source.length && /[A-Za-z0-9_]/.test(source[cursor])) {
    cursor += 1;
  }
  if (cursor < source.length && source[cursor] === "$") {
    return source.slice(index, cursor + 1);
  }
  return null;
}

export function splitSqlStatements(source) {
  const statements = [];
  let current = "";
  let quote = null;
  let dollarTag = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      current += char;
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      current += char;
      if (char === "*" && next === "/") {
        current += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        current += dollarTag;
        index += dollarTag.length - 1;
        dollarTag = null;
      } else {
        current += char;
      }
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) {
        if (next === quote) {
          current += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (char === "-" && next === "-") {
      current += char + next;
      index += 1;
      lineComment = true;
      continue;
    }
    if (char === "/" && next === "*") {
      current += char + next;
      index += 1;
      blockComment = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === "$") {
      const candidateTag = matchDollarQuoteTag(source, index);
      if (candidateTag) {
        dollarTag = candidateTag;
        current += candidateTag;
        index += candidateTag.length - 1;
        continue;
      }
    }
    if (char === ";") {
      if (current.replace(/--[^\n]*/g, "").trim()) {
        statements.push(current.trim());
      }
      current = "";
      continue;
    }
    current += char;
  }

  if (current.replace(/--[^\n]*/g, "").trim()) {
    statements.push(current.trim());
  }
  return statements;
}

const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(new URL("../db/migrations/", import.meta.url));

export async function runMigrations(client, { migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY, logger = console } = {}) {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => migrationVersion(left).localeCompare(migrationVersion(right)));

  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)"
  );

  const applied = [];
  const skipped = [];

  for (const file of files) {
    const version = migrationVersion(file);
    const existing = await client.query("SELECT version FROM schema_migrations WHERE version = $1", [version]);
    if (existing.rows.length > 0) {
      logger.log(`Skipping migration ${version}`);
      skipped.push(version);
      continue;
    }

    const contents = await readFile(join(migrationsDirectory, basename(file)), "utf8");
    const statements = splitSqlStatements(contents);

    await client.query("BEGIN");
    try {
      for (const statement of statements) {
        await client.query(statement);
      }
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
      await client.query("COMMIT");
      logger.log(`Applied migration ${version}`);
      applied.push(version);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  }

  return Object.freeze({ applied: Object.freeze(applied), skipped: Object.freeze(skipped) });
}

async function main() {
  const url = directDatabaseUrl(process.env);
  const client = new Client(buildPgClientConfig(url, { queryTimeoutMs: 30_000 }));
  await client.connect();
  try {
    await runMigrations(client);
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
