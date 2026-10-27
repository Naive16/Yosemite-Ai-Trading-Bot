import { loadConfig, ConfigurationError } from "../_lib/config.js";
import { checkLoginRateLimit, clearLoginAttempts, createSession, recordFailedLogin } from "../_lib/auth.js";
import { authenticateSupabaseOwner, SupabaseAuthServiceError, UnauthorizedOwnerError } from "../_lib/supabase.js";
import { DatabaseConfigurationError, DatabaseQueryError, getDatabase } from "../_lib/database.js";
import { insertAuditEvent, resolveSupabaseOwnerUser } from "../_lib/repository.js";
import { methodNotAllowed, sendJson, setSessionCookie } from "../_lib/http.js";
import { assertSameOrigin, InputValidationError, parseLoginPayload, SpoofedUserIdentityError } from "../_lib/validation.js";
import { RateLimitUnavailableError } from "../_lib/rate-limit.js";
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
  if (!config.auth.configured) return sendJson(response, 503, { status: "error", message: "Authentication is not configured" });
  if (!config.database.configured) return sendJson(response, 503, { status: "error", message: "Database is not configured" });

  try {
    assertSameOrigin(request, config.appOrigin);
    const credentials = parseLoginPayload(request);
    const db = getDatabase(runtimeEnv(request));
    const rate = await checkLoginRateLimit(db, request, config, credentials.email);
    if (!rate.allowed) return sendJson(response, 429, { status: "error", message: "Too many sign-in attempts" }, { "Retry-After": String(rate.retryAfterSeconds) });

    let authResult;
    try {
      authResult = await authenticateSupabaseOwner({
        email: credentials.email,
        password: credentials.password,
        config
      });
    } catch (error) {
      if (error instanceof UnauthorizedOwnerError) {
        await recordFailedLogin(db, rate.key, config);
        await insertAuditEvent(db, {
          eventType: "auth.access.denied",
          metadata: { provider: "supabase", reason: "not_workspace_owner" }
        });
        return sendJson(response, 403, { status: "error", code: "access_denied", message: "Access restricted to the workspace owner" });
      }
      if (error instanceof SupabaseAuthServiceError) {
        return sendJson(response, 503, { status: "error", message: "Authentication service unavailable" });
      }
      throw error;
    }

    if (!authResult.authenticated) {
      await recordFailedLogin(db, rate.key, config);
      await insertAuditEvent(db, {
        eventType: "auth.login.failed",
        metadata: { provider: "supabase", reason: "invalid_credentials" }
      });
      return sendJson(response, 401, { status: "error", message: "Invalid email or password" });
    }

    const user = await resolveSupabaseOwnerUser(db, {
      ownerUserId: authResult.user.id,
      email: authResult.user.email
    });
    if (!user) return sendJson(response, 503, { status: "error", message: "Authentication service unavailable" });

    await clearLoginAttempts(db, rate.key);
    const session = await createSession(user.id, config, db, { source: "supabase_password" });
    setSessionCookie(response, session.token, config.sessionTtlSeconds, config.appEnv === "production");
    return sendJson(response, 200, {
      status: "ok",
      user: { username: user.username, email: authResult.user.email },
      csrfToken: session.csrfToken,
      expiresAt: new Date(session.expiresAt).toISOString()
    });
  } catch (error) {
    if (error instanceof SpoofedUserIdentityError) return sendJson(response, 400, { status: "error", code: error.code, message: error.message });
    if (error instanceof InputValidationError) return sendJson(response, 400, { status: "error", message: error.message });
    if (error instanceof DatabaseConfigurationError || error instanceof DatabaseQueryError) return sendJson(response, 503, { status: "error", message: "Database unavailable" });
    if (error instanceof RateLimitUnavailableError) return sendJson(response, 503, { status: "error", code: "rate_limiter_unavailable", message: "Authentication service unavailable" });
    if (error instanceof TypeError) return sendJson(response, 400, { status: "error", message: "Invalid request" });
    throw error;
  }
}
