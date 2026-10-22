import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

function migrationVersion(fileName) {
  const match = /^(\d+)_.*\.sql$/.exec(fileName);
  if (!match) throw new Error(`Migration filename must start with a numeric version: ${fileName}`);
  return match[1].padStart(6, "0");
}

function directDatabaseUrl() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "";
  if (!url) throw new Error("DATABASE_URL_UNPOOLED or a direct DATABASE_URL is required");
  const parsed = new URL(url);
  if (parsed.hostname.includes("-pooler")) throw new Error("Migrations require a direct, non-pooled Neon connection URL");
  return url;
}

function splitSqlStatements(source) {
  const statements = [];
  let current = "";
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) { current += char; if (char === "\n") lineComment = false; continue; }
    if (blockComment) { current += char; if (char === "*" && next === "/") { current += next; index += 1; blockComment = false; } continue; }
    if (!quote && char === "-" && next === "-") { current += char + next; index += 1; lineComment = true; continue; }
    if (!quote && char === "/" && next === "*") { current += char + next; index += 1; blockComment = true; continue; }
    if (quote) {
      current += char;
      if (char === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; current += char; continue; }
    if (char === ";") { if (current.replace(/--[^\n]*/g, "").trim()) statements.push(current.trim()); current = ""; continue; }
    current += char;
  }
  if (current.replace(/--[^\n]*/g, "").trim()) statements.push(current.trim());
  return statements;
}

const migrationsDirectory = fileURLToPath(new URL("../db/migrations/", import.meta.url));
const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort((left, right) => migrationVersion(left).localeCompare(migrationVersion(right)));
const sql = neon(directDatabaseUrl());

await sql`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)`;

for (const file of files) {
  const version = migrationVersion(file);
  const existing = await sql`SELECT version FROM schema_migrations WHERE version = ${version}`;
  if (existing.length > 0) {
    console.log(`Skipping migration ${version}`);
    continue;
  }

  const contents = await readFile(join(migrationsDirectory, basename(file)), "utf8");
  const statements = splitSqlStatements(contents);
  await sql.transaction([
    ...statements.map((statement) => sql`${sql.unsafe(statement)}`),
    sql`INSERT INTO schema_migrations (version) VALUES (${version})`
  ]);
  console.log(`Applied migration ${version}`);
}
