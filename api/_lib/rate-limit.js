import { createHash } from "node:crypto";

export class RateLimitUnavailableError extends Error {
  constructor(message = "Shared rate limiter unavailable", cause) {
    super(message, { cause });
    this.name = "RateLimitUnavailableError";
  }
}

function bucketKey(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

let lastCleanupAt = 0;
let cleanupInFlight = null;

async function cleanupExpiredBuckets(db) {
  if (Date.now() - lastCleanupAt < 60_000) return;
  if (!cleanupInFlight) {
    cleanupInFlight = db.query(
      "DELETE FROM rate_limit_buckets WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day'",
      []
    ).then(() => { lastCleanupAt = Date.now(); }).finally(() => { cleanupInFlight = null; });
  }
  await cleanupInFlight;
}

function resultFromRow(row, maxRequests) {
  if (!row) throw new RateLimitUnavailableError("Shared rate limiter returned no state");
  const count = Number.isSafeInteger(Number(row.attempt_count)) ? Number(row.attempt_count) : Number.MAX_SAFE_INTEGER;
  const retryAfterSeconds = Math.max(0, Number.isSafeInteger(Number(row.retry_after_seconds)) ? Number(row.retry_after_seconds) : 0);
  return Object.freeze({ allowed: count <= maxRequests, retryAfterSeconds });
}

export async function consumeRateLimit(db, { key, windowSeconds, maxRequests }) {
  try {
    await cleanupExpiredBuckets(db);
    const result = await db.query(
      `INSERT INTO rate_limit_buckets (bucket_key, window_started_at, attempt_count, expires_at, updated_at)
       VALUES ($1, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP + ($2 * INTERVAL '1 second'), CURRENT_TIMESTAMP)
       ON CONFLICT (bucket_key) DO UPDATE
       SET window_started_at = CASE WHEN rate_limit_buckets.expires_at <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP ELSE rate_limit_buckets.window_started_at END,
           attempt_count = CASE WHEN rate_limit_buckets.expires_at <= CURRENT_TIMESTAMP THEN 1 ELSE rate_limit_buckets.attempt_count + 1 END,
           expires_at = CASE WHEN rate_limit_buckets.expires_at <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP + ($2 * INTERVAL '1 second') ELSE rate_limit_buckets.expires_at END,
           updated_at = CURRENT_TIMESTAMP
       RETURNING attempt_count, GREATEST(EXTRACT(EPOCH FROM (expires_at - CURRENT_TIMESTAMP)), 0)::integer AS retry_after_seconds`,
      [bucketKey(key), windowSeconds]
    );
    return resultFromRow(result.rows[0], maxRequests);
  } catch (error) {
    if (error instanceof RateLimitUnavailableError) throw error;
    throw new RateLimitUnavailableError(undefined, error);
  }
}

export async function checkRateLimit(db, { key, windowSeconds, maxRequests }) {
  try {
    await cleanupExpiredBuckets(db);
    const result = await db.query(
      `SELECT attempt_count, GREATEST(EXTRACT(EPOCH FROM (expires_at - CURRENT_TIMESTAMP)), 0)::integer AS retry_after_seconds
       FROM rate_limit_buckets
       WHERE bucket_key = $1 AND expires_at > CURRENT_TIMESTAMP`,
      [bucketKey(key)]
    );
    if (!result.rows[0]) return Object.freeze({ allowed: true, retryAfterSeconds: windowSeconds });
    const state = resultFromRow(result.rows[0], maxRequests);
    return Object.freeze({ ...state, allowed: Number(result.rows[0].attempt_count) < maxRequests });
  } catch (error) {
    throw new RateLimitUnavailableError(undefined, error);
  }
}

export async function recordRateLimitFailure(db, { key, windowSeconds }) {
  try {
    await cleanupExpiredBuckets(db);
    await db.query(
      `INSERT INTO rate_limit_buckets (bucket_key, window_started_at, attempt_count, expires_at, updated_at)
       VALUES ($1, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP + ($2 * INTERVAL '1 second'), CURRENT_TIMESTAMP)
       ON CONFLICT (bucket_key) DO UPDATE
       SET window_started_at = CASE WHEN rate_limit_buckets.expires_at <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP ELSE rate_limit_buckets.window_started_at END,
           attempt_count = CASE WHEN rate_limit_buckets.expires_at <= CURRENT_TIMESTAMP THEN 1 ELSE rate_limit_buckets.attempt_count + 1 END,
           expires_at = CASE WHEN rate_limit_buckets.expires_at <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP + ($2 * INTERVAL '1 second') ELSE rate_limit_buckets.expires_at END,
           updated_at = CURRENT_TIMESTAMP`,
      [bucketKey(key), windowSeconds]
    );
  } catch (error) {
    throw new RateLimitUnavailableError(undefined, error);
  }
}

export async function clearRateLimit(db, key) {
  try {
    await db.query("DELETE FROM rate_limit_buckets WHERE bucket_key = $1", [bucketKey(key)]);
  } catch (error) {
    throw new RateLimitUnavailableError(undefined, error);
  }
}

export function rateLimitKey(parts) {
  return parts.filter((part) => part !== undefined && part !== null).join(":");
}
