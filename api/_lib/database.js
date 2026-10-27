import pg from "pg";
import { isHyperdriveHostname, loadConfig } from "./config.js";

const { Client, Pool } = pg;

/**
 * Official Supabase Root 2021 CA (SHA-256: 807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA)
 * used when verify-ca or verify-full TLS is requested against Supabase PostgreSQL / Supavisor endpoints.
 */
const SUPABASE_ROOT_2021_CA_PEM = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`;

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

function isWorkersRuntime() {
  return (
    typeof globalThis.WebSocketPair !== "undefined" ||
    (typeof navigator !== "undefined" && navigator?.userAgent === "Cloudflare-Workers")
  );
}

function isLocalHostname(hostname) {
  const normalized = String(hostname || "").toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

function isSupabaseHostname(hostname) {
  const normalized = String(hostname || "").toLowerCase();
  return normalized.endsWith(".pooler.supabase.com") || normalized.endsWith(".supabase.com") || normalized.endsWith(".supabase.co");
}

export function buildPgClientConfig(connectionString, { queryTimeoutMs = 5_000 } = {}) {
  if (!connectionString) throw new DatabaseConfigurationError("DATABASE_URL is not configured");
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new DatabaseConfigurationError("DATABASE_URL must be a valid PostgreSQL connection URL");
  }

  const hyperdriveHost = isHyperdriveHostname(parsed.hostname);
  const rawSslMode = (parsed.searchParams.get("sslmode") || "").trim().toLowerCase();
  const effectiveSslMode = rawSslMode || (isLocalHostname(parsed.hostname) ? "prefer" : "verify-full");

  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("pgbouncer");
  parsed.searchParams.delete("uselibpqcompat");

  let ssl;
  if (hyperdriveHost || effectiveSslMode === "disable" || (effectiveSslMode === "prefer" && isLocalHostname(parsed.hostname))) {
    ssl = false;
  } else {
    const baseTlsConfig = isSupabaseHostname(parsed.hostname)
      ? { rejectUnauthorized: true, ca: SUPABASE_ROOT_2021_CA_PEM }
      : { rejectUnauthorized: true };
    ssl = effectiveSslMode === "verify-ca"
      ? Object.freeze({ ...baseTlsConfig, checkServerIdentity: () => undefined })
      : Object.freeze(baseTlsConfig);
  }

  return Object.freeze({
    connectionString: parsed.toString(),
    ssl,
    connectionTimeoutMillis: queryTimeoutMs,
    query_timeout: queryTimeoutMs,
    application_name: "yosemite-ai"
  });
}

function withTimeout(promise, timeoutMs) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new DatabaseQueryError("Database query timed out")), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

function normalizeRows(result) {
  return { rows: Array.isArray(result) ? result : result?.rows || [] };
}

function assertValidQueryArgs(text, values) {
  if (typeof text !== "string" || !Array.isArray(values)) {
    throw new TypeError("Database query must contain SQL text and an array of parameters");
  }
}

async function wrapDriverCall(operation, timeoutMs) {
  try {
    return await withTimeout(operation(), timeoutMs);
  } catch (error) {
    if (error instanceof DatabaseQueryError) throw error;
    throw new DatabaseQueryError("Database query failed", error);
  }
}

async function runSqlTransaction(rawQuery, timeoutMs, callback) {
  if (typeof callback !== "function") throw new TypeError("Transaction callback must be a function");
  await wrapDriverCall(() => rawQuery("BEGIN", []), timeoutMs);
  const tx = Object.freeze({
    async query(text, values = []) {
      assertValidQueryArgs(text, values);
      const result = await wrapDriverCall(() => rawQuery(text, values), timeoutMs);
      return normalizeRows(result);
    }
  });
  try {
    const outcome = await callback(tx);
    await wrapDriverCall(() => rawQuery("COMMIT", []), timeoutMs);
    return outcome;
  } catch (error) {
    await Promise.resolve(rawQuery("ROLLBACK", [])).catch(() => {});
    throw error;
  }
}

export function createDatabaseClient(config, driver = null, options = {}) {
  if (!config?.database?.url) throw new DatabaseConfigurationError("DATABASE_URL is not configured");
  const timeoutMs = config.database.queryTimeoutMs || 5_000;
  const pgConfig = buildPgClientConfig(config.database.url, { queryTimeoutMs: timeoutMs });

  if (typeof driver === "function") {
    const customExecutor = driver(config.database.url, pgConfig);
    return Object.freeze({
      async query(text, values = []) {
        assertValidQueryArgs(text, values);
        const result = await wrapDriverCall(() => customExecutor.query(text, values), timeoutMs);
        return normalizeRows(result);
      },
      async transaction(callback) {
        if (typeof customExecutor.connect === "function") {
          const session = await wrapDriverCall(() => customExecutor.connect(), timeoutMs);
          try {
            return await runSqlTransaction((text, values) => session.query(text, values), timeoutMs, callback);
          } finally {
            if (typeof session.release === "function") session.release();
          }
        }
        return runSqlTransaction((text, values) => customExecutor.query(text, values), timeoutMs, callback);
      },
      async ping() {
        await this.query("SELECT 1 AS ok WHERE clock_timestamp() IS NOT NULL", []);
        return true;
      },
      async close() {
        if (typeof customExecutor.end === "function") await customExecutor.end();
      }
    });
  }

  const serverless = options.serverless ?? isWorkersRuntime();

  if (serverless) {
    return Object.freeze({
      async query(text, values = []) {
        assertValidQueryArgs(text, values);
        const client = new Client(pgConfig);
        client.on("error", () => {});
        try {
          const result = await wrapDriverCall(async () => {
            await client.connect();
            return client.query(text, values);
          }, timeoutMs);
          return normalizeRows(result);
        } finally {
          await client.end().catch(() => {});
        }
      },
      async transaction(callback) {
        const client = new Client(pgConfig);
        client.on("error", () => {});
        try {
          await wrapDriverCall(() => client.connect(), timeoutMs);
          return await runSqlTransaction((text, values) => client.query(text, values), timeoutMs, callback);
        } finally {
          await client.end().catch(() => {});
        }
      },
      async ping() {
        await this.query("SELECT 1 AS ok WHERE clock_timestamp() IS NOT NULL", []);
        return true;
      },
      async close() {}
    });
  }

  const pool = new Pool({
    ...pgConfig,
    max: 5,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true
  });
  pool.on("error", () => {});

  return Object.freeze({
    async query(text, values = []) {
      assertValidQueryArgs(text, values);
      const result = await wrapDriverCall(() => pool.query(text, values), timeoutMs);
      return normalizeRows(result);
    },
    async transaction(callback) {
      const client = await wrapDriverCall(() => pool.connect(), timeoutMs);
      try {
        return await runSqlTransaction((text, values) => client.query(text, values), timeoutMs, callback);
      } finally {
        client.release();
      }
    },
    async ping() {
      await this.query("SELECT 1 AS ok WHERE clock_timestamp() IS NOT NULL", []);
      return true;
    },
    async close() {
      await pool.end().catch(() => {});
    }
  });
}

export function getDatabase(env = process.env) {
  if (testDatabase) return testDatabase;
  const config = loadConfig(env);
  if (!config.database.configured) throw new DatabaseConfigurationError("DATABASE_URL is not configured");
  if (isWorkersRuntime()) {
    return createDatabaseClient(config, null, { serverless: true });
  }
  if (!cachedDatabase || cachedDatabase.url !== config.database.url) {
    if (cachedDatabase?.client?.close) {
      void cachedDatabase.client.close();
    }
    cachedDatabase = { url: config.database.url, client: createDatabaseClient(config, null, { serverless: false }) };
  }
  return cachedDatabase.client;
}

export function setDatabaseForTests(database) {
  testDatabase = database;
}

export function clearDatabaseTestOverride() {
  testDatabase = null;
  if (cachedDatabase?.client?.close) {
    void cachedDatabase.client.close();
  }
  cachedDatabase = null;
}
