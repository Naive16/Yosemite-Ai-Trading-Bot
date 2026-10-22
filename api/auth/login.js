import { loadConfig, ConfigurationError } from "../_lib/config.js";
import { checkLoginRateLimit, clearLoginAttempts, createSession, recordFailedLogin, verifyPassword } from "../_lib/auth.js";
import { DatabaseConfigurationError, DatabaseQueryError, getDatabase } from "../_lib/database.js";
import { ensureConfiguredUser, insertAuditEvent } from "../_lib/repository.js";
import { header, methodNotAllowed, sendJson, setSessionCookie } from "../_lib/http.js";
import { assertSameOrigin, InputValidationError, parseLoginPayload } from "../_lib/validation.js";
import { RateLimitUnavailableError } from "../_lib/rate-limit.js";

export default async function handler(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, "POST");

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) return sendJson(response, 503, { status: "error", message: "Authentication is not configured" });
    throw error;
  }
  if (!config.auth.configured) return sendJson(response, 503, { status: "error", message: "Authentication is not configured" });
  if (!config.database.configured) return sendJson(response, 503, { status: "error", message: "Database is not configured" });

  try {
    assertSameOrigin(request, config.appOrigin);
    const credentials = parseLoginPayload(request);
    const db = getDatabase();
    const rate = await checkLoginRateLimit(db, request, config, credentials.username);
    if (!rate.allowed) return sendJson(response, 429, { status: "error", message: "Too many sign-in attempts" }, { "Retry-After": String(rate.retryAfterSeconds) });

    const user = await ensureConfiguredUser(db, { username: config.auth.username, passwordHash: config.auth.passwordHash });
    if (!user) return sendJson(response, 503, { status: "error", message: "Authentication service unavailable" });
    const passwordValid = await verifyPassword(credentials.password, user.password_hash);
    const usernameValid = credentials.username === user.username;
    if (!usernameValid || !passwordValid) {
      await recordFailedLogin(db, rate.key, config);
      await insertAuditEvent(db, { eventType: "auth.login.failed", metadata: { reason: "invalid_credentials" } });
      return sendJson(response, 401, { status: "error", message: "Invalid username or password" });
    }

    await clearLoginAttempts(db, rate.key);
    const session = await createSession(user.id, config, db, { source: "password" });
    setSessionCookie(response, session.token, config.sessionTtlSeconds, config.appEnv === "production");
    return sendJson(response, 200, { status: "ok", user: { username: user.username }, csrfToken: session.csrfToken, expiresAt: new Date(session.expiresAt).toISOString() });
  } catch (error) {
    if (error instanceof InputValidationError) return sendJson(response, 400, { status: "error", message: error.message });
    if (error instanceof DatabaseConfigurationError || error instanceof DatabaseQueryError) return sendJson(response, 503, { status: "error", message: "Database unavailable" });
    if (error instanceof RateLimitUnavailableError) return sendJson(response, 503, { status: "error", code: "rate_limiter_unavailable", message: "Authentication service unavailable" });
    if (error instanceof TypeError) return sendJson(response, 400, { status: "error", message: "Invalid request" });
    throw error;
  }
}
