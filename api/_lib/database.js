import { PostgrestClient } from "@supabase/postgrest-js";
import { loadConfig } from "./config.js";

let testDatabase = null;
export class DatabaseConfigurationError extends Error {
  constructor(message = "Supabase database is not configured") { super(message); this.name = "DatabaseConfigurationError"; }
}
export class DatabaseQueryError extends Error {
  constructor(message = "Supabase database query failed", cause) { super(message, { cause }); this.name = "DatabaseQueryError"; }
}

function createDataClient(url, key, options) {
  return new PostgrestClient(`${url}/rest/v1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...options.global?.headers }
  });
}
export function createDatabaseClient(config, factory = createDataClient) {
  const supabase = config?.supabase;
  if (!supabase?.url || !(supabase.publishableKey || supabase.key)) throw new DatabaseConfigurationError();
  const timeoutMs = supabase.queryTimeoutMs || config.database?.queryTimeoutMs || 5_000;
  function clientFor(token) {
    return factory(supabase.url, supabase.publishableKey || supabase.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: token ? { headers: { Authorization: `Bearer ${token}` } } : {}
    });
  }
  let client = clientFor(null);
  const database = {
    get client() { return client; },
    authorize(accessToken) {
      if (typeof accessToken !== "string" || !accessToken) throw new DatabaseConfigurationError("A verified Supabase access token is required");
      client = clientFor(accessToken);
      return database;
    },
    async execute(operation) {
      let timer;
      const controller = new AbortController();
      if (typeof operation?.abortSignal === "function") operation = operation.abortSignal(controller.signal);
      try {
        const result = await Promise.race([
          operation,
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new DatabaseQueryError("Supabase database query timed out")); }, timeoutMs); })
        ]);
        if (result?.error) throw new DatabaseQueryError(undefined, result.error);
        return result?.data ?? null;
      } catch (error) {
        if (error instanceof DatabaseQueryError) throw error;
        throw new DatabaseQueryError(undefined, error);
      } finally { clearTimeout(timer); }
    },
    async verifySession() {
      const data = await database.execute(client.rpc("yosemite_session_context"));
      return (Array.isArray(data) ? data[0] : data) || null;
    },
    async ping() {
      const session = await database.verifySession();
      if (!session?.active_session || !session.user_id) throw new DatabaseQueryError("Supabase database permission check failed");
      return true;
    }
  };
  return database;
}

// A fresh client per request prevents JWT and I/O state leaking between Workers requests.
export function getDatabase(env = process.env) {
  if (testDatabase) return testDatabase;
  return createDatabaseClient(loadConfig(env));
}
export function setDatabaseForTests(database) { testDatabase = database; }
export function clearDatabaseTestOverride() { testDatabase = null; }
