import { createHash, createPublicKey, verify } from "node:crypto";
import { AuthClient } from "@supabase/auth-js";
import { header } from "./http.js";

let authClientFactoryForTests = null;
let cloudflareJwksCache = null;
let cloudflareJwksFetchedAt = 0;
const CLOUDFLARE_JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
export function clearCloudflareJwksCacheForTests() { cloudflareJwksCache = null; cloudflareJwksFetchedAt = 0; }
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

export function cloudflareAssertionFrom(request) {
  return header(request, "cf-access-jwt-assertion") || "";
}

function base64urlDecode(str) {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  return Buffer.from(base64, "base64");
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Cloudflare Access JWKS fetch failed: ${response.status}`);
  return response.json();
}

async function getCloudflareJwks(jwksUrl) {
  const now = Date.now();
  if (cloudflareJwksCache && cloudflareJwksFetchedAt > now - CLOUDFLARE_JWKS_CACHE_TTL_MS) {
    return cloudflareJwksCache;
  }
  const jwks = await fetchJson(jwksUrl);
  cloudflareJwksCache = jwks;
  cloudflareJwksFetchedAt = now;
  return jwks;
}

export async function verifyCloudflareAssertion(assertion, config) {
  const jwksUrl = config?.cloudflareAccess?.jwksUrl;
  if (!jwksUrl) throw new AuthError(503, "configuration_invalid", "Cloudflare Access JWKS URL is not configured");
  const parts = assertion.split(".");
  if (parts.length !== 3) throw new AuthError(401, "invalid_cloudflare_assertion", "Malformed Cloudflare Access assertion");
  let header;
  let payload;
  try {
    header = JSON.parse(base64urlDecode(parts[0]).toString("utf8"));
    payload = JSON.parse(base64urlDecode(parts[1]).toString("utf8"));
  } catch { throw new AuthError(401, "invalid_cloudflare_assertion", "Malformed Cloudflare Access assertion"); }
  if (header.alg !== "RS256") throw new AuthError(401, "invalid_cloudflare_assertion", "Unsupported assertion algorithm");
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp <= now) throw new AuthError(401, "invalid_cloudflare_assertion", "Assertion expired");
  if (payload.nbf && payload.nbf > now) throw new AuthError(401, "invalid_cloudflare_assertion", "Assertion not yet valid");
  const expectedIss = `https://${new URL(jwksUrl).hostname}`;
  if (payload.iss !== expectedIss) throw new AuthError(401, "invalid_cloudflare_assertion", "Untrusted issuer");
  const jwks = await getCloudflareJwks(jwksUrl);
  const key = jwks.keys?.find((k) => k.kid === header.kid && k.kty === "RSA" && k.use === "sig");
  if (!key) throw new AuthError(401, "invalid_cloudflare_assertion", "Signing key not found");
  const publicKey = createPublicKey({ key, format: "jwk" });
  const data = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = base64urlDecode(parts[2]);
  const valid = verify("RSA-SHA256", data, publicKey, signature);
  if (!valid) throw new AuthError(401, "invalid_cloudflare_assertion", "Assertion signature verification failed");
  const expectedAud = config?.cloudflareAccess?.audience;
  if (expectedAud && payload.aud !== expectedAud) throw new AuthError(401, "invalid_cloudflare_assertion", "Untrusted audience");
  return { email: payload.email, sub: payload.sub, aud: payload.aud, iss: payload.iss };
}

export async function getCloudflareSession(assertion, db, config) {
  const identity = await verifyCloudflareAssertion(assertion, config);
  if (!identity.email) throw new AuthError(401, "invalid_cloudflare_assertion", "Assertion does not contain an email");
  // Switch to the server-side service-role client: Cloudflare Access provides the
  // authentication boundary, Supabase RLS cannot resolve auth.uid() without a
  // browser-issued Supabase JWT, so data operations are gated by application-level
  // user_id filtering instead. The service-role key never reaches the browser.
  db.authorizeAdmin();
  const user = await db.getUserByUsername(identity.email);
  if (!user || !user.id) throw new AuthError(403, "dashboard_access_denied", "This account is not authorized to access the dashboard");
  return {
    token: null,
    userId: user.id,
    authUserId: null,
    username: user.username || identity.email,
    email: identity.email,
    source: "cloudflare",
    authenticated: true
  };
}
export async function getSession(request, db, config) {
  const token = accessTokenFrom(request);
  if (token) {
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
  // Path 2: Cloudflare Access assertion. Cloudflare Access is the edge
  // authentication boundary (its own IdP login page; no application login form).
  // The Worker verifies the Cf-Access-Jwt-Assertion JWT and maps the asserted
  // email to an app_users row (username = email). Data operations then run through
  // the server-side service-role client with application-level user_id filtering.
  const assertion = cloudflareAssertionFrom(request);
  if (assertion) {
    return await getCloudflareSession(assertion, db, config);
  }
  return null;
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
export function csrfMatches(request, session) {
  if (!session) return false;
  if (session.source === "cloudflare") return true; // Cloudflare Access validates CSRF at the edge
  return Boolean(accessTokenFrom(request) === session.token);
}
export function getClientIdentifier(request, config = null) {
  const trusted = config?.trustedProxy?.mode === "platform" || !config?.trustedProxy;
  const identifier = trusted ? header(request, "x-real-ip") || "unknown" : "untrusted-proxy";
  return createHash("sha256").update(identifier).digest("hex").slice(0, 32);
}

