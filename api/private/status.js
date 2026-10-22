import { loadConfig, ConfigurationError } from "../_lib/config.js";
import { getSession } from "../_lib/auth.js";
import { DatabaseConfigurationError, DatabaseQueryError, getDatabase } from "../_lib/database.js";
import { sendJson, methodNotAllowed } from "../_lib/http.js";

export default async function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, "GET");
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) return sendJson(response, 503, { status: "error", message: "Authentication is not configured" });
    throw error;
  }
  if (!config.auth.configured) return sendJson(response, 401, { status: "error", message: "Authentication required" });
  if (!config.database.configured) return sendJson(response, 503, { status: "error", message: "Database is not configured" });
  try {
    const session = await getSession(request, getDatabase(), config);
    if (!session) return sendJson(response, 401, { status: "error", message: "Authentication required" });
    return sendJson(response, 200, { status: "ok", user: { username: session.username }, tradingEnabled: false, liveTradingEnabled: false, mode: config.tradingMode });
  } catch (error) {
    if (error instanceof DatabaseConfigurationError || error instanceof DatabaseQueryError) return sendJson(response, 503, { status: "error", message: "Database unavailable" });
    throw error;
  }
}
