import { loadConfig, ConfigurationError } from "../_lib/config.js";
import { AuthError, authFailure, createAuthClient, getSession, revokeSupabaseSession } from "../_lib/auth.js";
import { DatabaseConfigurationError, DatabaseQueryError, getDatabase } from "../_lib/database.js";
import { methodNotAllowed, sendJson } from "../_lib/http.js";
import { assertSameOrigin, InputValidationError, parseLoginPayload } from "../_lib/validation.js";
import { runtimeEnv } from "../_lib/runtime.js";

export default async function handler(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, "POST");
  let issuedToken; let config;
  try {
    config = loadConfig(runtimeEnv(request));
    assertSameOrigin(request, config.appOrigin);
    const credentials = parseLoginPayload(request);
    let result;
    try { result = await createAuthClient(config).auth.signInWithPassword(credentials); }
    catch { throw new AuthError(503, "authentication_unavailable", "Supabase authentication is unavailable"); }
    if (result.error) throw authFailure(result.error);
    const officialSession = result.data?.session;
    issuedToken = officialSession?.access_token;
    if (!issuedToken) throw new AuthError(503, "authentication_unavailable", "Supabase authentication is unavailable");
    const session = await getSession({ ...request, headers: { ...request.headers, authorization: "Bearer " + issuedToken } }, getDatabase(runtimeEnv(request)), config);
    if (!session) throw new AuthError(401, "authentication_required", "Authentication required");
    return sendJson(response, 200, { status: "ok", user: { username: session.username }, session: officialSession, expiresAt: session.expiresAt.toISOString() });
  } catch (error) {
    if (issuedToken && config) { try { await revokeSupabaseSession(issuedToken, config); } catch { /* Failed authorization never returns a token to the caller. */ } }
    if (error instanceof AuthError) return sendJson(response, error.status, { status: "error", code: error.code, message: error.message });
    if (error instanceof ConfigurationError) return sendJson(response, 503, { status: "error", code: "configuration_invalid", message: "Application configuration is unavailable" });
    if (error instanceof InputValidationError) return sendJson(response, /Origin|Referer/.test(error.message) ? 403 : 400, { status: "error", message: error.message });
    if (error instanceof DatabaseConfigurationError || error instanceof DatabaseQueryError) return sendJson(response, 503, { status: "error", code: "database_unavailable", message: "Database unavailable" });
    throw error;
  }
}

