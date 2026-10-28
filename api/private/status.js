import { loadConfig, ConfigurationError } from "../_lib/config.js";
import { AuthError, getSession } from "../_lib/auth.js";
import { DatabaseConfigurationError, DatabaseQueryError, getDatabase } from "../_lib/database.js";
import { sendJson, methodNotAllowed } from "../_lib/http.js";
import { runtimeEnv } from "../_lib/runtime.js";

export default async function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, "GET");
  let config;
  try {
    config = loadConfig(runtimeEnv(request));
  } catch (error) {
    if (error instanceof ConfigurationError) return sendJson(response, 503, { status: "error", code: "configuration_invalid", message: "Application configuration is unavailable" });
    throw error;
  }
  if (!config.auth.configured) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" });
  if (!config.database.configured) return sendJson(response, 503, { status: "error", message: "Database is not configured" });
  try {
    const session = await getSession(request, getDatabase(runtimeEnv(request)), config);
    if (!session) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" });
    return sendJson(response, 200, { status: "ok", user: { username: session.username }, tradingEnabled: false, liveTradingEnabled: false, mode: config.tradingMode });
  } catch (error) { if (error instanceof AuthError) return sendJson(response, error.status, { status: "error", code: error.code, message: error.message });
    if (error instanceof DatabaseConfigurationError || error instanceof DatabaseQueryError) return sendJson(response, 503, { status: "error", message: "Database unavailable" });
    throw error;
  }
}
