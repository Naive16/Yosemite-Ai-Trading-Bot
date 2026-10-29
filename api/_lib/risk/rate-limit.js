import { consumeRateLimit, rateLimitKey } from "../rate-limit.js";
import { getClientIdentifier } from "../auth.js";
let riskRateLimitGeneration = 0;
// Cloudflare Access sessions run through the server-side service-role client, for
// which Supabase auth.uid() is null and the yosemite_rate_limit RPC cannot build a
// per-user bucket key. An in-memory per-isolate bucket is used instead (degraded:
// it does not survive Worker restarts; production should route Cloudflare sessions
// through a persisted rate-limit store). Supabase bearer sessions continue to use
// the persisted RPC-backed limiter.
const cloudflareRiskRateLimitBuckets = new Map();
async function checkCloudflareRateLimit(userId, config) {
  const windowSeconds = config.claude.rateLimitWindowSeconds;
  const maxRequests = config.claude.rateLimitMaxRequests;
  const now = Date.now();
  let bucket = cloudflareRiskRateLimitBuckets.get(userId) || { count: 0, resetAt: now + windowSeconds * 1000 };
  if (now > bucket.resetAt) bucket = { count: 0, resetAt: now + windowSeconds * 1000 };
  bucket.count += 1;
  bucket.resetAt = now + windowSeconds * 1000;
  cloudflareRiskRateLimitBuckets.set(userId, bucket);
  const allowed = bucket.count <= maxRequests;
  const retryAfterSeconds = allowed ? 0 : Math.max(0, Math.ceil((bucket.resetAt - now) / 1000));
  return Object.freeze({ allowed, retryAfterSeconds });
}
export async function checkRiskRateLimit(db, request, config, userId, session) {
  if (session && session.source === "cloudflare") {
    return checkCloudflareRateLimit(userId || "anonymous", config);
  }
  return consumeRateLimit(db, { key: rateLimitKey(["risk", riskRateLimitGeneration, userId || "anonymous", getClientIdentifier(request, config)]), windowSeconds: config.claude.rateLimitWindowSeconds, maxRequests: config.claude.rateLimitMaxRequests });
}
export function clearRiskRateLimit() { riskRateLimitGeneration += 1; }
