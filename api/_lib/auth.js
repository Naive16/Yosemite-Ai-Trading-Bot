import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { header } from "./http.js";
import { createSessionWithAudit, deriveCsrfToken, findActiveSession, hashCsrfToken, insertAuditEvent, revokeSessionWithAudit } from "./repository.js";
import { checkRateLimit, clearRateLimit, rateLimitKey, recordRateLimitFailure } from "./rate-limit.js";
import { clearSupabaseFetchTestOverride, UnauthorizedOwnerError } from "./supabase.js";
import { assertNoSpoofedUserIdentity } from "./validation.js";

const scrypt = promisify(scryptCallback);
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_DEFAULTS = Object.freeze({ N: 16_384, r: 8, p: 1 });
let loginRateLimitGeneration = 0;

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function constantTimeStringEqual(left, right) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseScryptHash(encoded) {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (![n, r, p].every(Number.isSafeInteger) || n < 1_024 || n > 1_048_576 || r < 1 || r > 32 || p < 1 || p > 8) return null;
  try {
    const salt = Buffer.from(parts[4], "base64url");
    const digest = Buffer.from(parts[5], "base64url");
    if (salt.length < 16 || digest.length !== SCRYPT_KEY_LENGTH) return null;
    return { n, r, p, salt, digest };
  } catch {
    return null;
  }
}

export async function hashPassword(password, options = SCRYPT_DEFAULTS) {
  if (typeof password !== "string" || password.length < 12 || password.length > 256) throw new Error("Password length is invalid");
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, SCRYPT_KEY_LENGTH, { N: options.N, r: options.r, p: options.p, maxmem: 128 * options.N * options.r + 1_024 * 1_024 });
  return `scrypt$${options.N}$${options.r}$${options.p}$${base64Url(salt)}$${base64Url(derivedKey)}`;
}

export async function verifyPassword(password, encodedHash) {
  const parsed = parseScryptHash(encodedHash);
  if (!parsed || typeof password !== "string" || password.length > 256) return false;
  try {
    const derivedKey = await scrypt(password, parsed.salt, SCRYPT_KEY_LENGTH, { N: parsed.n, r: parsed.r, p: parsed.p, maxmem: 128 * parsed.n * parsed.r + 1_024 * 1_024 });
    return timingSafeEqual(Buffer.from(derivedKey), parsed.digest);
  } catch {
    return false;
  }
}

export function getClientIdentifier(request, config = null) {
  const trustProxy = config?.trustedProxy?.mode === "platform" || !config?.trustedProxy;
  const forwarded = trustProxy ? header(request, "x-forwarded-for").split(",")[0].trim() : "";
  const remote = trustProxy ? (header(request, "x-real-ip") || "unknown") : "untrusted-proxy";
  return createHash("sha256").update(forwarded || remote).digest("hex").slice(0, 32);
}

export async function checkLoginRateLimit(db, request, config, username) {
  const key = rateLimitKey(["login", loginRateLimitGeneration, getClientIdentifier(request, config), username]);
  const state = await checkRateLimit(db, { key, windowSeconds: config.rateLimitWindowSeconds, maxRequests: config.rateLimitMaxAttempts });
  return { ...state, key };
}

export async function recordFailedLogin(db, key, config) {
  await recordRateLimitFailure(db, { key, windowSeconds: config.rateLimitWindowSeconds });
}

export async function clearLoginAttempts(db, key) {
  await clearRateLimit(db, key);
}

export async function createSession(userId, config, db, metadata = {}) {
  const token = base64Url(randomBytes(32));
  const csrfToken = deriveCsrfToken(token, config.sessionSecret);
  const expiresAt = new Date(Date.now() + config.sessionTtlSeconds * 1_000);
  await createSessionWithAudit(db, { userId, token, csrfToken, sessionSecret: config.sessionSecret, expiresAt, metadata });
  return { token, csrfToken, expiresAt };
}

export async function getSession(request, db, config) {
  assertNoSpoofedUserIdentity(request);
  const cookieHeader = header(request, "cookie");
  const token = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith("yosemite_session="))?.slice("yosemite_session=".length) || "";
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
  const session = await findActiveSession(db, { token, sessionSecret: config.sessionSecret });
  if (!session) return null;
  const csrfToken = deriveCsrfToken(token, config.sessionSecret);
  if (!constantTimeStringEqual(session.csrf_token_hash, hashCsrfToken(csrfToken, config.sessionSecret))) return null;
  if (!config?.supabase?.ownerUserId || !constantTimeStringEqual(String(session.user_id).toLowerCase(), config.supabase.ownerUserId)) {
    await insertAuditEvent(db, {
      eventType: "auth.access.denied",
      metadata: { provider: "supabase", reason: "session_not_workspace_owner" }
    });
    throw new UnauthorizedOwnerError();
  }
  return { token, userId: session.user_id, username: session.username, csrfToken, createdAt: session.created_at, expiresAt: session.expires_at };
}

export async function destroySession(request, db, config, metadata = {}, resolvedSession = null) {
  const session = resolvedSession || await getSession(request, db, config);
  if (session) await revokeSessionWithAudit(db, { token: session.token, sessionSecret: config.sessionSecret, metadata });
  return session;
}

export function clearAuthState() {
  loginRateLimitGeneration += 1;
  clearSupabaseFetchTestOverride();
}

export function csrfMatches(request, session) {
  const token = header(request, "x-csrf-token");
  return Boolean(token && session && constantTimeStringEqual(token, session.csrfToken));
}
