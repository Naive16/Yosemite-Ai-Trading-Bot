import { loadConfig, ConfigurationError } from "../_lib/config.js";
import { accessTokenFrom, AuthError, revokeSupabaseSession } from "../_lib/auth.js";
import { methodNotAllowed, sendJson } from "../_lib/http.js";
import { assertSameOrigin, InputValidationError } from "../_lib/validation.js";
import { runtimeEnv } from "../_lib/runtime.js";

export default async function handler(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, "POST");
  try {
    const config = loadConfig(runtimeEnv(request));
    assertSameOrigin(request, config.appOrigin);
    const token = accessTokenFrom(request);
    if (!token) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" });
    // Logout remains possible after dashboard membership is revoked.
    await revokeSupabaseSession(token, config);
    return sendJson(response, 200, { status: "ok" });
  } catch (error) {
    if (error instanceof AuthError) return sendJson(response, error.status, { status: "error", code: error.code, message: error.message });
    if (error instanceof ConfigurationError) return sendJson(response, 503, { status: "error", code: "configuration_invalid", message: "Application configuration is unavailable" });
    if (error instanceof InputValidationError) return sendJson(response, 403, { status: "error", message: "Request origin is not allowed" });
    throw error;
  }
}

