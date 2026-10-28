import { consumeRateLimit, rateLimitKey } from "../rate-limit.js";
import { getClientIdentifier } from "../auth.js";
let riskRateLimitGeneration = 0;

export async function checkRiskRateLimit(db, request, config, userId) {
  return consumeRateLimit(db, { key: rateLimitKey(["risk", riskRateLimitGeneration, userId || "anonymous", getClientIdentifier(request, config)]), windowSeconds: config.claude.rateLimitWindowSeconds, maxRequests: config.claude.rateLimitMaxRequests });
}
export function clearRiskRateLimit() { riskRateLimitGeneration += 1; }
