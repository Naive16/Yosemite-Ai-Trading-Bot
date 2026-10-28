import { createHash } from "node:crypto";
import { AuthClient } from "@supabase/auth-js";
import { header } from "./http.js";

let authClientFactoryForTests = null;
export class AuthError extends Error {
  constructor(status, code, message) { super(message); this.name = "AuthError"; this.status = status; this.code = code; }
}
export function createAuthClient(config) {
  if (!config.supabase?.configured) throw new AuthError(503, "authentication_not_configured", "Supabase authentication is not configured");
  if (authClientFactoryForTests) return authClientFactoryForTests(config);
  // Use the official Auth client directly: REST authentication needs no Realtime/WebSocket runtime.
  return { auth: new AuthClient({
    url: config.supabase.url + "/auth/v1",
    headers: { apikey: config.supabase.publishableKey },
    persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
    fetch: async (url, options = {}) => {
      try { return await fetch(url, { ...options, signal: AbortSignal.timeout(config.database.queryTimeoutMs) }); }
      catch { throw new Error("Authentication transport unavailable"); }
    }
  }) };
}
export function setAuthClientFactoryForTests(factory) { authClientFactoryForTests = factory; }
export function clearAuthState() { authClientFactoryForTests = null; }
function isAuthConfigurationFailure(error) {
  return ["email_provider_disabled", "provider_disabled", "invalid_api_key"].includes(error?.code) || /(?:invalid|missing|no) api key|api key (?:is )?(?:invalid|missing)/i.test(String(error?.message || ""));
}
export function authFailure(error) {
  if (isAuthConfigurationFailure(error)) return new AuthError(503, "configuration_invalid", "Supabase authentication configuration is unavailable");
  if (error?.status === 429) return new AuthError(429, "rate_limited", "Too many authentication requests. Try again later");
  if ([400, 401, 403, 422].includes(error?.status)) return new AuthError(401, "invalid_credentials", "Invalid email or password");
  return new AuthError(503, "authentication_unavailable", "Supabase authentication is unavailable");
}
export function accessTokenFrom(request) {
  return /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(header(request, "authorization"))?.[1] || "";
}
export async function getSession(request, db, config) {
  const token = accessTokenFrom(request);
  if (!token) return null;
  let result;
  try { result = await createAuthClient(config).auth.getUser(token); }
  catch { throw new AuthError(503, "authentication_unavailable", "Supabase authentication is unavailable"); }
  if (result.error) {
    const failure = authFailure(result.error);
    if (failure.status === 401) return null;
    throw failure;
  }
  if (!result.data?.user?.id) return null;
  // Decode only after verification by the project's Auth server. Browser metadata never authorizes access.
  let claims;
  try { claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); } catch { return null; }
  if (claims.sub !== result.data.user.id || claims.iss !== config.supabase.url + "/auth/v1" || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) return null;
  db.authorize(token);
  const context = await db.verifySession();
  if (!context?.active_session) return null;
  if (!context.user_id || context.auth_user_id !== result.data.user.id) throw new AuthError(403, "dashboard_access_denied", "This account is not authorized to access the dashboard");
  return { token, userId: context.user_id, authUserId: context.auth_user_id, username: context.username || result.data.user.email, expiresAt: new Date(claims.exp * 1000) };
}
export async function revokeSupabaseSession(token, config) {
  let result;
  try { result = await createAuthClient(config).auth.admin.signOut(token, "local"); }
  catch { throw new AuthError(503, "authentication_unavailable", "Sign-out could not be confirmed. Try again"); }
  if (isAuthConfigurationFailure(result.error)) throw authFailure(result.error);
  // Match the official SDK: an invalid, expired or already missing session can
  // still be cleared locally. Transport/server failures remain retryable.
  if (result.error && ![401, 403, 404].includes(result.error.status) && result.error.name !== "AuthSessionMissingError") throw new AuthError(503, "authentication_unavailable", "Sign-out could not be confirmed. Try again");
}
// Browsers do not automatically attach bearer credentials. Cookie authentication is never accepted.
export function csrfMatches(request, session) { return Boolean(session && accessTokenFrom(request) === session.token); }
export function getClientIdentifier(request, config = null) {
  const trusted = config?.trustedProxy?.mode === "platform" || !config?.trustedProxy;
  const identifier = trusted ? header(request, "x-real-ip") || "unknown" : "untrusted-proxy";
  return createHash("sha256").update(identifier).digest("hex").slice(0, 32);
}

