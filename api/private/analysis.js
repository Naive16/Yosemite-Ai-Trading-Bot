import { loadConfig, ConfigurationError } from "../_lib/config.js";
import { AuthError, getSession } from "../_lib/auth.js";
import { DatabaseConfigurationError, DatabaseQueryError, getDatabase } from "../_lib/database.js";
import { sendJson, methodNotAllowed } from "../_lib/http.js";
import { getSymbolDefinition, getTimeframeDefinition } from "../_lib/market-data/symbols.js";
import { MarketDataProviderError, createMarketDataProvider } from "../_lib/market-data/provider.js";
import { checkMarketDataRateLimit } from "../_lib/market-data/rate-limit.js";
import { checkAiRateLimit } from "../_lib/ai/rate-limit.js";
import { createNewsProvider, NewsProviderError } from "../_lib/news/provider.js";
import { createAnalysisClient, ClaudeProviderError } from "../_lib/claude/client.js";
import { evaluateBaselineStrategy, STRATEGY_NAME, StrategyInputError } from "../_lib/strategy/engine.js";
import { RateLimitUnavailableError } from "../_lib/rate-limit.js";
import { runtimeEnv } from "../_lib/runtime.js";

function unavailable(response, code = "analysis_unavailable", status = 503, extraHeaders = {}) { return sendJson(response, status, { status: "unavailable", code, recommendation: "NO TRADE", message: "AI market analysis is unavailable" }, extraHeaders); }

function parseQuery(request, config) {
  const url = request?.url ? new URL(request.url, "http://localhost") : null;
  const source = request?.query && typeof request.query === "object" ? request.query : Object.fromEntries(url?.searchParams || []);
  const keys = Object.keys(source);
  if (keys.some((key) => !["symbol", "timeframe"].includes(key))) throw new StrategyInputError("Unexpected analysis parameter");
  const symbol = typeof source.symbol === "string" ? source.symbol.trim() : "EUR/USD";
  const timeframe = typeof source.timeframe === "string" ? source.timeframe.trim() : "M15";
  if (!getSymbolDefinition(symbol)) throw new StrategyInputError("symbol is unavailable");
  if (!getTimeframeDefinition(timeframe)) throw new StrategyInputError("timeframe is unsupported");
  return { symbol, timeframe, limit: Math.max(90, config.strategy.slowMaPeriod + 2) };
}

function snapshot({ query, quote, candles, candidate, news, higherTimeframe }) {
  return { symbol: query.symbol, timeframe: query.timeframe, evaluationTimestamp: candidate.evaluatedAt, quote: { price: quote.price, bid: quote.bid ?? null, ask: quote.ask ?? null, spread: quote.spread ?? null, timestamp: quote.timestamp, source: quote.source, dataMode: quote.dataMode, freshness: quote.freshness }, candles: { count: candles.candles.length, firstTimestamp: candles.candles[0]?.timestamp || null, lastTimestamp: candles.candles.at(-1)?.timestamp || null, qualityWarnings: candles.qualityWarnings || [] }, technical: { indicators: candidate.indicators, strategy: candidate }, higherTimeframe: higherTimeframe || { status: "unavailable", reason: "not_requested" }, news: news || { status: "unavailable", reason: "news_context_unavailable", items: [], qualityWarnings: ["news_context_unavailable"] } };
}

export default async function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, "GET");
  let config; try { config = loadConfig(runtimeEnv(request)); } catch (error) { if (error instanceof ConfigurationError) return unavailable(response, "configuration_invalid"); throw error; }
  if (!config.auth.configured) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" });
  if (!config.database.configured) return unavailable(response, "database_unavailable");
  let session; let database; try { database = getDatabase(runtimeEnv(request)); session = await getSession(request, database, config); } catch (error) { if (error instanceof AuthError) return sendJson(response, error.status, { status: "error", code: error.code, message: error.message }); if (error instanceof DatabaseConfigurationError || error instanceof DatabaseQueryError) return unavailable(response, "database_unavailable"); throw error; }
  if (!session) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" });
  let aiLimit; let marketLimit;
  try { aiLimit = await checkAiRateLimit(database, request, config, session.userId); marketLimit = await checkMarketDataRateLimit(database, request, config, session.userId); } catch (error) { if (error instanceof AuthError) return sendJson(response, error.status, { status: "error", code: error.code, message: error.message });
    if (error instanceof RateLimitUnavailableError) return unavailable(response, "rate_limiter_unavailable");
    throw error;
  }
  if (!aiLimit.allowed) return sendJson(response, 429, { status: "error", code: "rate_limited", message: "AI analysis rate limit reached" }, { "Retry-After": String(aiLimit.retryAfterSeconds) });
  if (!marketLimit.allowed) return sendJson(response, 429, { status: "error", code: "rate_limited", message: "Market data rate limit reached" }, { "Retry-After": String(marketLimit.retryAfterSeconds) });
  let query; try { query = parseQuery(request, config); } catch (error) { if (error instanceof StrategyInputError) return sendJson(response, 400, { status: "error", code: "invalid_request", message: error.message }); throw error; }
  const analysisClient = createAnalysisClient(config); if (!analysisClient.configured) return unavailable(response, "missing_credentials");
  const provider = createMarketDataProvider(config); if (!provider.configured) return unavailable(response, "market_data_unavailable");
  try {
    const [quote, candles] = await Promise.all([provider.getQuote(query.symbol, { staleAfterSeconds: config.strategy.quoteMaxAgeSeconds }), provider.getCandles(query.symbol, query.timeframe, query.limit)]);
    const candidate = evaluateBaselineStrategy({ symbol: query.symbol, timeframe: query.timeframe, candles: candles.candles, quote, strategyConfig: config.strategy });
    let higherTimeframe = null;
    if (query.timeframe !== "H1" && getTimeframeDefinition("H1")) {
      try { const higher = await provider.getCandles(query.symbol, "H1", Math.max(40, config.strategy.slowMaPeriod + 2)); higherTimeframe = { status: "available", timeframe: "H1", lastTimestamp: higher.candles.at(-1)?.timestamp || null, qualityWarnings: higher.qualityWarnings || [] }; } catch { higherTimeframe = { status: "unavailable", reason: "higher_timeframe_unavailable" }; }
    }
    let news = { status: "unavailable", reason: "news_context_unavailable", items: [], qualityWarnings: ["news_context_unavailable"] };
    try { news = await createNewsProvider(config).getEvents(); } catch (error) { if (!(error instanceof NewsProviderError)) throw error; news = { status: "unavailable", reason: error.code, items: [], qualityWarnings: ["news_context_unavailable"] }; }
    const evidence = snapshot({ query, quote, candles, candidate, news, higherTimeframe });
    const analysis = await analysisClient.analyze(evidence);
    return sendJson(response, 200, { status: "ok", analysis, evidence: { symbol: query.symbol, timeframe: query.timeframe, marketData: { source: quote.source, dataMode: quote.dataMode, freshness: quote.freshness }, news: { status: news.status, items: news.items, qualityWarnings: news.qualityWarnings }, deterministicCandidate: candidate } });
  } catch (error) {
    if (error instanceof MarketDataProviderError) return unavailable(response, error.code, error.status);
    if (error instanceof ClaudeProviderError) { const headers = error.retryAfterSeconds == null ? {} : { "Retry-After": String(error.retryAfterSeconds) }; return unavailable(response, error.code, error.status, headers); }
    if (error instanceof StrategyInputError) return unavailable(response, "invalid_market_data", 422);
    throw error;
  }
}
