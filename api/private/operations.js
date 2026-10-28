import { loadConfig, ConfigurationError } from "../_lib/config.js";
import { AuthError, getSession } from "../_lib/auth.js";
import { DatabaseConfigurationError, DatabaseQueryError, getDatabase } from "../_lib/database.js";
import { buildHealthReport, heartbeatHealth } from "../_lib/operations/health.js";
import { methodNotAllowed, sendJson } from "../_lib/http.js";
import { runtimeEnv } from "../_lib/runtime.js";

export default async function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, "GET");
  let config;
  try { config = loadConfig(runtimeEnv(request)); } catch (error) {
    if (error instanceof ConfigurationError) return sendJson(response, 503, { status: "error", message: "Operational configuration is unavailable" });
    throw error;
  }
  if (!config.auth.configured) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" });
  if (!config.database.configured) return sendJson(response, 503, { status: "error", message: "Database is not configured" });
  try {
    const database = getDatabase(runtimeEnv(request));
    const session = await getSession(request, database, config);
    if (!session) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" });
    let databaseState = { state: "unknown", reason: "Database health was not established" };
    try { await database.ping(); databaseState = { state: "healthy", source: "Supabase session-context permission check" }; }
    catch { databaseState = { state: "unavailable", reason: "Database probe failed" }; }
    const report = buildHealthReport({ components: {
      process: { state: "operational", source: "server" },
      database: databaseState,
      marketData: config.marketData.configured ? { state: "unknown", reason: "Provider configured; no quote probe was requested" } : { state: "unavailable", reason: "No market-data provider credentials configured" },
      analysis: config.claude.configured ? { state: "unknown", reason: "Analysis provider configured; no live analysis probe was requested" } : { state: "unavailable", reason: "Claude credentials are not configured" },
      worker: heartbeatHealth({ enabled: config.worker.enabled, intervalSeconds: config.worker.heartbeatIntervalSeconds }),
      paper: { state: "unknown", reason: "Paper state is not a health signal" },
      mt5: { state: "unavailable", reason: "MT5 adapter is disabled" },
      account: { state: "unknown", reason: "No broker account is connected" },
      reconciliation: { state: "unknown", reason: "Durable reconciliation backlog query is not exposed in this read-only diagnostic" },
      risk: { state: "blocked", reason: "Execution remains disabled and trusted account state is unavailable" }
    } });
    return sendJson(response, report.status === "degraded" ? 503 : 200, { status: "ok", user: { username: session.username }, ...report });
  } catch (error) {
    if (error instanceof AuthError) return sendJson(response, error.status, { status: "error", code: error.code, message: error.message });
    if (error instanceof DatabaseConfigurationError || error instanceof DatabaseQueryError) return sendJson(response, 503, { status: "error", message: "Database unavailable" });
    throw error;
  }
}
