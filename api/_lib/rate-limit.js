import { createHash } from "node:crypto";
export class RateLimitUnavailableError extends Error {
  constructor(message = "Shared rate limiter unavailable", cause) { super(message, { cause }); this.name = "RateLimitUnavailableError"; }
}
function bucketKey(value) { return createHash("sha256").update(String(value)).digest("hex"); }
async function state(db, { key, windowSeconds = 900 }, action) {
  try {
    const rows = await db.execute(db.client.rpc("yosemite_rate_limit", { p_key: bucketKey(key), p_window_seconds: windowSeconds, p_action: action }));
    if (!rows?.[0]) throw new Error("Missing shared rate-limit state");
    return rows[0];
  } catch (error) { throw new RateLimitUnavailableError(undefined, error); }
}
function resultFromRow(row, maxRequests, consume) {
  const count = Number(row.attempt_count);
  if (!Number.isSafeInteger(count) || count < 0) throw new RateLimitUnavailableError();
  const seconds = Math.ceil(Number(row.retry_after_seconds));
  return Object.freeze({ allowed: consume ? count <= maxRequests : count < maxRequests, retryAfterSeconds: Number.isFinite(seconds) ? Math.max(0, seconds) : 0 });
}
export async function consumeRateLimit(db, options) { return resultFromRow(await state(db, options, "consume"), options.maxRequests, true); }
export async function checkRateLimit(db, options) { return resultFromRow(await state(db, options, "check"), options.maxRequests, false); }
export async function recordRateLimitFailure(db, options) { await state(db, options, "consume"); }
export async function clearRateLimit(db, key) { await state(db, { key }, "clear"); }
export function rateLimitKey(parts) { return parts.filter((part) => part !== undefined && part !== null).join(":"); }
