import { loadConfig, ConfigurationError } from "../_lib/config.js";
import { getSession } from "../_lib/auth.js";
import { DatabaseConfigurationError, DatabaseQueryError, getDatabase } from "../_lib/database.js";
import { sendJson, methodNotAllowed } from "../_lib/http.js";
import { MarketDataProviderError, createMarketDataProvider } from "../_lib/market-data/provider.js";
import { MarketDataCache } from "../_lib/market-data/cache.js";
import { MarketDataValidationError, parseMarketDataQuery } from "../_lib/market-data/validation.js";
import { checkMarketDataRateLimit } from "../_lib/market-data/rate-limit.js";
import { latestCandleFreshness } from "../_lib/market-data/normalize.js";
import { getTimeframeDefinition } from "../_lib/market-data/symbols.js";
import { RateLimitUnavailableError } from "../_lib/rate-limit.js";
import { runtimeEnv } from "../_lib/runtime.js";

const cache = new MarketDataCache();

function unavailable(response, code = "provider_unavailable") {
  return sendJson(response, 503, { status: "unavailable", code, source: "none", dataMode: "unavailable", message: "Live market data is unavailable" });
}

export function clearMarketDataCache() { cache.clear(); }

export default async function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, "GET");
  let config;
  try { config = loadConfig(runtimeEnv(request)); } catch (error) {
    if (error instanceof ConfigurationError) return unavailable(response, "configuration_invalid");
    throw error;
  }
  if (!config.auth.configured) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" });
  if (!config.database.configured) return unavailable(response, "database_unavailable");

  let session; let database;
  try { database = getDatabase(runtimeEnv(request)); session = await getSession(request, database, config); } catch (error) {
    if (error instanceof DatabaseConfigurationError || error instanceof DatabaseQueryError) return unavailable(response, "database_unavailable");
    throw error;
  }
  if (!session) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" });

  let limitState;
  try { limitState = await checkMarketDataRateLimit(database, request, config, session.userId); } catch (error) {
    if (error instanceof RateLimitUnavailableError) return unavailable(response, "rate_limiter_unavailable");
    throw error;
  }
  if (!limitState.allowed) return sendJson(response, 429, { status: "error", code: "rate_limited", message: "Market data request rate limit reached" }, { "Retry-After": String(limitState.retryAfterSeconds) });

  let query;
  try { query = parseMarketDataQuery(request); } catch (error) {
    if (error instanceof MarketDataValidationError) return sendJson(response, 400, { status: "error", code: "invalid_request", message: error.message });
    throw error;
  }

  const provider = createMarketDataProvider(config);
  if (!provider.configured) return unavailable(response, provider.reason);
  const cacheKey = `${provider.id}:${query.kind}:${query.symbol}:${query.timeframe}:${query.limit}`;
  const cached = cache.get(cacheKey, config.marketData.cacheSeconds * 1_000);
  if (cached) return sendJson(response, 200, { ...cached.value, cached: true, dataMode: cached.value.dataMode === "live" ? "cached" : cached.value.dataMode });

  try {
    if (query.kind === "quote") {
      const quote = await provider.getQuote(query.symbol, { staleAfterSeconds: config.marketData.quoteStaleSeconds });
      const body = { status: "ok", kind: "quote", symbol: query.symbol, source: quote.source, dataMode: quote.dataMode, cached: false, quote };
      cache.set(cacheKey, body);
      return sendJson(response, 200, body);
    }
    const candles = await provider.getCandles(query.symbol, query.timeframe, query.limit);
    const freshness = latestCandleFreshness(candles.candles, getTimeframeDefinition(query.timeframe).seconds);
    const body = { status: "ok", kind: "candles", symbol: query.symbol, timeframe: query.timeframe, source: candles.source, dataMode: candles.dataMode, cached: false, freshness, qualityWarnings: candles.qualityWarnings, supportedTimeframes: candles.supportedTimeframes, candles: candles.candles };
    cache.set(cacheKey, body);
    return sendJson(response, 200, body);
  } catch (error) {
    if (error instanceof MarketDataProviderError) {
      const status = error.status === 429 ? 429 : error.status;
      const headers = error.retryAfterSeconds == null ? {} : { "Retry-After": String(error.retryAfterSeconds) };
      const message = error.code === "symbol_unavailable" ? "Market data is unavailable for this symbol" : error.code === "market_closed" ? "The market is closed or has no current session" : "Market data is unavailable";
      return sendJson(response, status, { status: error.code === "missing_credentials" || error.code === "provider_disabled" ? "unavailable" : "error", code: error.code, source: provider.source, dataMode: "unavailable", message }, headers);
    }
    throw error;
  }
}
