import { loadConfig, ConfigurationError } from "../_lib/config.js";
import { csrfMatches, getSession, destroySession } from "../_lib/auth.js";
import { DatabaseConfigurationError, DatabaseQueryError, getDatabase } from "../_lib/database.js";
import { clearSessionCookie, methodNotAllowed, sendJson } from "../_lib/http.js";
import { assertSameOrigin, InputValidationError } from "../_lib/validation.js";
import { runtimeEnv } from "../_lib/runtime.js";

export default async function handler(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, "POST");
  let config;
  try {
    config = loadConfig(runtimeEnv(request));
  } catch (error) {
    if (error instanceof ConfigurationError) return sendJson(response, 503, { status: "error", message: "Authentication is not configured" });
    throw error;
  }
  if (!config.database.configured) return sendJson(response, 503, { status: "error", message: "Database is not configured" });
  try {
    assertSameOrigin(request, config.appOrigin);
    const db = getDatabase(runtimeEnv(request));
    const session = await getSession(request, db, config);
    if (!session || !csrfMatches(request, session)) return sendJson(response, 401, { status: "error", message: "Authentication required" });
    await destroySession(request, db, config, { source: "user" });
    clearSessionCookie(response, config.appEnv === "production");
    return sendJson(response, 200, { status: "ok" });
  } catch (error) {
    if (error instanceof InputValidationError) return sendJson(response, 403, { status: "error", message: "Request origin is not allowed" });
    if (error instanceof DatabaseConfigurationError || error instanceof DatabaseQueryError) return sendJson(response, 503, { status: "error", message: "Database unavailable" });
    throw error;
  }
}
