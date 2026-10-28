import { consumeRateLimit, rateLimitKey } from "../rate-limit.js";
import { getClientIdentifier } from "../auth.js";
let aiRateLimitGeneration = 0;

export async function checkAiRateLimit(db, request, config, userId) {
  return consumeRateLimit(db, { key: rateLimitKey(["ai", aiRateLimitGeneration, userId || "anonymous", getClientIdentifier(request, config)]), windowSeconds: config.claude.rateLimitWindowSeconds, maxRequests: config.claude.rateLimitMaxRequests });
}

export function clearAiRateLimit() { aiRateLimitGeneration += 1; }
