import { loadConfig, ConfigurationError } from "../_lib/config.js";
import { getSession } from "../_lib/auth.js";
import { DatabaseConfigurationError, DatabaseQueryError, getDatabase } from "../_lib/database.js";
import { sendJson, methodNotAllowed } from "../_lib/http.js";
import { MarketDataProviderError, createMarketDataProvider } from "../_lib/market-data/provider.js";
import { checkMarketDataRateLimit } from "../_lib/market-data/rate-limit.js";
import { getSymbolDefinition, getTimeframeDefinition } from "../_lib/market-data/symbols.js";
import { latestCandleFreshness } from "../_lib/market-data/normalize.js";
import { evaluateBaselineStrategy, STRATEGY_NAME, StrategyInputError } from "../_lib/strategy/engine.js";
import { RateLimitUnavailableError } from "../_lib/rate-limit.js";
import { runtimeEnv } from "../_lib/runtime.js";

const ALLOWED_QUERY_KEYS = new Set(["symbol", "timeframe", "strategy", "limit"]);

function queryValue(source, key, fallback) {
  const value = source[key] ?? fallback;
  if (Array.isArray(value)) throw new StrategyInputError(`${key} is invalid`);
  return typeof value === "string" ? value.trim() : value;
}

function parseQuery(request, config) {
  const url = request?.url ? new URL(request.url, "http://localhost") : null;
  const source = request?.query && typeof request.query === "object" ? request.query : Object.fromEntries(url?.searchParams || []);
  if (Object.keys(source).some((key) => !ALLOWED_QUERY_KEYS.has(key))) throw new StrategyInputError("Unexpected strategy parameter");
  const symbol = queryValue(source, "symbol", "EUR/USD");
  const timeframe = queryValue(source, "timeframe", "M15");
  const strategy = queryValue(source, "strategy", STRATEGY_NAME);
  const rawLimit = queryValue(source, "limit", String(Math.max(90, config.strategy.slowMaPeriod + 2)));
  if (!getSymbolDefinition(symbol)) throw new StrategyInputError("symbol is unavailable");
  if (!getTimeframeDefinition(timeframe)) throw new StrategyInputError("timeframe is unsupported");
  if (strategy !== STRATEGY_NAME) throw new StrategyInputError("strategy is unsupported");
  if (!/^\d+$/.test(String(rawLimit))) throw new StrategyInputError("limit must be an integer");
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < Math.max(10, config.strategy.slowMaPeriod + 2) || limit > Math.min(300, config.marketData.maxCandles)) throw new StrategyInputError("limit is outside the allowed range");
  return { symbol, timeframe, strategy, limit };
}

function unavailable(response, code = "strategy_unavailable") {
  return sendJson(response, 503, { status: "unavailable", code, direction: "NO TRADE", dataMode: "unavailable", message: "Candidate analysis is unavailable" });
}

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
  if (!limitState.allowed) return sendJson(response, 429, { status: "error", code: "rate_limited", message: "Candidate analysis rate limit reached" }, { "Retry-After": String(limitState.retryAfterSeconds) });
  let query;
  try { query = parseQuery(request, config); } catch (error) {
    if (error instanceof StrategyInputError) return sendJson(response, 400, { status: "error", code: "invalid_request", message: error.message });
    throw error;
  }
  const provider = createMarketDataProvider(config);
  if (!provider.configured) return unavailable(response, provider.reason);
  try {
    const [quote, candleResult] = await Promise.all([
      provider.getQuote(query.symbol, { staleAfterSeconds: config.strategy.quoteMaxAgeSeconds }),
      provider.getCandles(query.symbol, query.timeframe, query.limit)
    ]);
    const candidate = evaluateBaselineStrategy({ symbol: query.symbol, timeframe: query.timeframe, candles: candleResult.candles, quote, strategyConfig: config.strategy });
    return sendJson(response, 200, { status: "ok", candidate, source: quote.source, dataMode: quote.dataMode, supportedTimeframes: candleResult.supportedTimeframes, marketData: { quote, candleFreshness: latestCandleFreshness(candleResult.candles, getTimeframeDefinition(query.timeframe).seconds), qualityWarnings: candleResult.qualityWarnings } });
  } catch (error) {
    if (error instanceof MarketDataProviderError) {
      const headers = error.retryAfterSeconds == null ? {} : { "Retry-After": String(error.retryAfterSeconds) };
      const message = error.code === "market_closed" ? "The market is closed or has no current session" : error.code === "symbol_unavailable" ? "Market data is unavailable for this symbol" : "Candidate analysis is unavailable";
      return sendJson(response, error.status, { status: error.status === 429 ? "error" : "unavailable", code: error.code, direction: "NO TRADE", dataMode: "unavailable", message }, headers);
    }
    if (error instanceof StrategyInputError) return sendJson(response, 422, { status: "error", code: "invalid_market_data", direction: "NO TRADE", message: "Validated market data cannot support candidate analysis" });
    throw error;
  }
}
