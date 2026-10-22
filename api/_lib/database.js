import { neon } from "@neondatabase/serverless";
import { loadConfig } from "./config.js";

let cachedDatabase = null;
let testDatabase = null;

export class DatabaseConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

export class DatabaseQueryError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "DatabaseQueryError";
  }
}

function withTimeout(promise, timeoutMs) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new DatabaseQueryError("Database query timed out")), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

export function createDatabaseClient(config, driver = neon) {
  if (!config?.database?.url) throw new DatabaseConfigurationError("DATABASE_URL is not configured");
  const sql = driver(config.database.url);
  return Object.freeze({
    async query(text, values = []) {
      if (typeof text !== "string" || !Array.isArray(values)) throw new TypeError("Database query must contain SQL text and an array of parameters");
      try {
        const rows = await withTimeout(sql.query(text, values), config.database.queryTimeoutMs);
        return { rows: Array.isArray(rows) ? rows : rows?.rows || [] };
      } catch (error) {
        if (error instanceof DatabaseQueryError) throw error;
        throw new DatabaseQueryError("Database query failed", error);
      }
    },
    async ping() {
      await this.query("SELECT 1 AS ok", []);
      return true;
    }
  });
}

export function getDatabase(env = process.env) {
  if (testDatabase) return testDatabase;
  const config = loadConfig(env);
  if (!config.database.configured) throw new DatabaseConfigurationError("DATABASE_URL is not configured");
  if (!cachedDatabase || cachedDatabase.url !== config.database.url) {
    cachedDatabase = { url: config.database.url, client: createDatabaseClient(config) };
  }
  return cachedDatabase.client;
}

export function setDatabaseForTests(database) {
  testDatabase = database;
}

export function clearDatabaseTestOverride() {
  testDatabase = null;
  cachedDatabase = null;
}
