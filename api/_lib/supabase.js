import { timingSafeEqual } from "node:crypto";

const SUPABASE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SUPABASE_RESPONSE_BYTES = 32 * 1024;

let supabaseFetchOverride = null;

function constantTimeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left), "utf8");
  const rightBuffer = Buffer.from(String(right), "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export class SupabaseAuthServiceError extends Error {
  constructor(message = "Supabase authentication service unavailable", code = "supabase_unavailable") {
    super(message);
    this.name = "SupabaseAuthServiceError";
    this.code = code;
  }
}

export class UnauthorizedOwnerError extends Error {
  constructor(message = "Access restricted to the workspace owner") {
    super(message);
    this.name = "UnauthorizedOwnerError";
    this.code = "access_denied";
  }
}

export function setSupabaseFetchForTests(fetchFn) {
  supabaseFetchOverride = typeof fetchFn === "function" ? fetchFn : null;
}

export function clearSupabaseFetchTestOverride() {
  supabaseFetchOverride = null;
}

async function fetchJsonBounded(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, { ...options, signal: controller.signal });
  } catch {
    throw new SupabaseAuthServiceError("Supabase authentication request failed", "network_error");
  } finally {
    clearTimeout(timer);
  }

  let rawText = "";
  try {
    rawText = await response.text();
  } catch {
    throw new SupabaseAuthServiceError("Supabase authentication response could not be read", "invalid_response");
  }

  if (Buffer.byteLength(rawText, "utf8") > MAX_SUPABASE_RESPONSE_BYTES) {
    throw new SupabaseAuthServiceError("Supabase authentication response exceeded size limit", "response_too_large");
  }

  let data = null;
  if (rawText.trim()) {
    try {
      data = JSON.parse(rawText);
    } catch {
      if (response.status >= 500 || response.ok) {
        throw new SupabaseAuthServiceError("Supabase authentication returned malformed JSON", "malformed_json");
      }
    }
  }

  return { status: response.status, ok: response.ok, data };
}

function isServerApiKeyRejection(status, data) {
  if (status !== 401 && status !== 403) return false;
  const code = String(data?.error_code || data?.code || "").toLowerCase();
  const message = String(data?.msg || data?.message || data?.error_description || data?.error || "").toLowerCase();
  return code === "invalid_api_key" || message.includes("invalid api key") || message.includes("no api key found");
}

async function revokeTemporarySupabaseSession(fetchImpl, supabaseConfig, accessToken) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(supabaseConfig.timeoutMs, 3_000));
  try {
    await fetchImpl(`${supabaseConfig.url}/auth/v1/logout?scope=local`, {
      method: "POST",
      headers: {
        apikey: supabaseConfig.anonKey,
        Authorization: `Bearer ${accessToken}`
      },
      signal: controller.signal
    });
  } catch {
    // Best-effort cleanup of upstream token; Yosemite enforces its own revocable PostgreSQL session.
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Authenticate an email + password login against Supabase Auth and independently
 * verify the resulting access token via GET /auth/v1/user before checking single-owner
 * authorization against SUPABASE_OWNER_USER_ID.
 */
export async function authenticateSupabaseOwner({ email, password, config, fetchImpl = null }) {
  const supabaseConfig = config?.supabase;
  if (!supabaseConfig?.configured) {
    throw new SupabaseAuthServiceError("Supabase authentication is not configured", "unconfigured");
  }

  const runtimeFetch = fetchImpl || supabaseFetchOverride || globalThis.fetch;
  if (typeof runtimeFetch !== "function") {
    throw new SupabaseAuthServiceError("Fetch implementation is unavailable", "fetch_unavailable");
  }

  const tokenResult = await fetchJsonBounded(
    runtimeFetch,
    `${supabaseConfig.url}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        apikey: supabaseConfig.anonKey
      },
      body: JSON.stringify({ email, password })
    },
    supabaseConfig.timeoutMs
  );

  if (!tokenResult.ok) {
    if (isServerApiKeyRejection(tokenResult.status, tokenResult.data)) {
      throw new SupabaseAuthServiceError("Supabase API key was rejected", "invalid_api_key");
    }
    if (tokenResult.status === 400 || tokenResult.status === 401 || tokenResult.status === 403 || tokenResult.status === 422) {
      return { authenticated: false };
    }
    if (tokenResult.status === 429) {
      throw new SupabaseAuthServiceError("Supabase authentication rate limit reached", "upstream_rate_limited");
    }
    throw new SupabaseAuthServiceError("Supabase authentication failed", "upstream_error");
  }

  const accessToken = tokenResult.data?.access_token;
  if (typeof accessToken !== "string" || accessToken.length < 20 || accessToken.length > 8_192 || /\s/.test(accessToken)) {
    throw new SupabaseAuthServiceError("Supabase access token response is invalid", "invalid_token_response");
  }

  // Independently verify the access token with Supabase Auth's /auth/v1/user endpoint
  // rather than trusting unverified response fields or any client-supplied identifier.
  let userResult;
  try {
    userResult = await fetchJsonBounded(
      runtimeFetch,
      `${supabaseConfig.url}/auth/v1/user`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          apikey: supabaseConfig.anonKey,
          Authorization: `Bearer ${accessToken}`
        }
      },
      supabaseConfig.timeoutMs
    );
  } finally {
    await revokeTemporarySupabaseSession(runtimeFetch, supabaseConfig, accessToken);
  }

  if (!userResult.ok) {
    if (userResult.status === 401 || userResult.status === 403) {
      return { authenticated: false };
    }
    throw new SupabaseAuthServiceError("Supabase user verification failed", "user_verification_failed");
  }

  const verifiedUser = userResult.data;
  const rawUserId = typeof verifiedUser?.id === "string" ? verifiedUser.id.trim() : "";
  if (!SUPABASE_UUID_PATTERN.test(rawUserId)) {
    throw new SupabaseAuthServiceError("Supabase user identifier is invalid", "invalid_user_id");
  }
  if (verifiedUser?.aud && verifiedUser.aud !== "authenticated") {
    return { authenticated: false };
  }
  if (!verifiedUser?.email_confirmed_at && !verifiedUser?.confirmed_at) {
    return { authenticated: false };
  }

  const verifiedEmail = typeof verifiedUser?.email === "string" ? verifiedUser.email.trim().toLowerCase() : "";
  if (!verifiedEmail || verifiedEmail.length > 254) {
    throw new SupabaseAuthServiceError("Supabase user email is missing", "invalid_user_email");
  }

  const normalizedUserId = rawUserId.toLowerCase();
  if (!constantTimeStringEqual(normalizedUserId, supabaseConfig.ownerUserId)) {
    throw new UnauthorizedOwnerError();
  }

  return Object.freeze({
    authenticated: true,
    user: Object.freeze({
      id: normalizedUserId,
      email: verifiedEmail
    })
  });
}
