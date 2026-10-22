import { getClientIdentifier } from "../auth.js";
import { consumeRateLimit, rateLimitKey } from "../rate-limit.js";
let marketDataRateLimitGeneration = 0;

export async function checkMarketDataRateLimit(db, request, config, userId) {
  return consumeRateLimit(db, { key: rateLimitKey(["market-data", marketDataRateLimitGeneration, userId, getClientIdentifier(request, config)]), windowSeconds: config.marketData.rateLimitWindowSeconds, maxRequests: config.marketData.rateLimitMaxRequests });
}

export function clearMarketDataRateLimit() { marketDataRateLimitGeneration += 1; }
