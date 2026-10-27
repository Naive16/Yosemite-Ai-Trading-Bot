import { loadConfig, ConfigurationError } from "../_lib/config.js";
import { getSession } from "../_lib/auth.js";
import { UnauthorizedOwnerError } from "../_lib/supabase.js";
import { DatabaseConfigurationError, DatabaseQueryError, getDatabase } from "../_lib/database.js";
import { methodNotAllowed, sendJson } from "../_lib/http.js";
import { SpoofedUserIdentityError } from "../_lib/validation.js";
import { runtimeEnv } from "../_lib/runtime.js";

export default async function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, "GET");
  let config;
  try {
    config = loadConfig(runtimeEnv(request));
  } catch (error) {
    if (error instanceof ConfigurationError) return sendJson(response, 503, { status: "error", message: "Authentication is not configured" });
    throw error;
  }
  if (!config.auth.configured) return sendJson(response, 503, { status: "error", message: "Authentication is not configured" });
  if (!config.database.configured) return sendJson(response, 503, { status: "error", message: "Database is not configured" });
  try {
    const session = await getSession(request, getDatabase(runtimeEnv(request)), config);
    if (!session) return sendJson(response, 401, { status: "error", message: "Authentication required" });
    return sendJson(response, 200, { status: "ok", user: { username: session.username }, csrfToken: session.csrfToken, expiresAt: new Date(session.expiresAt).toISOString() });
  } catch (error) {
    if (error instanceof SpoofedUserIdentityError) return sendJson(response, 400, { status: "error", code: error.code, message: error.message });
    if (error instanceof UnauthorizedOwnerError) return sendJson(response, 403, { status: "error", code: "access_denied", message: "Access restricted to the workspace owner" });
    if (error instanceof DatabaseConfigurationError || error instanceof DatabaseQueryError) return sendJson(response, 503, { status: "error", message: "Database unavailable" });
    throw error;
  }
}
