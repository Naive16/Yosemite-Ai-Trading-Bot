const DEFAULT_APP_ORIGIN = "http://localhost:3000";
const DEFAULT_SESSION_TTL_SECONDS = 1_800;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 900;
const DEFAULT_RATE_LIMIT_MAX_ATTEMPTS = 5;
const DEFAULT_DATABASE_QUERY_TIMEOUT_MS = 5_000;
const DEFAULT_MARKET_DATA_TIMEOUT_MS = 5_000;
const DEFAULT_MARKET_DATA_MAX_RETRIES = 1;
const DEFAULT_MARKET_DATA_CACHE_SECONDS = 10;
const DEFAULT_MARKET_DATA_MAX_CANDLES = 300;
const DEFAULT_MARKET_DATA_QUOTE_STALE_SECONDS = 120;
const DEFAULT_MARKET_DATA_RATE_LIMIT_WINDOW_SECONDS = 60;
const DEFAULT_MARKET_DATA_RATE_LIMIT_MAX_REQUESTS = 60;
const DEFAULT_MARKET_DATA_BASE_URL = "https://api.twelvedata.com";
const DEFAULT_STRATEGY_FAST_MA_PERIOD = 10;
const DEFAULT_STRATEGY_SLOW_MA_PERIOD = 30;
const DEFAULT_STRATEGY_RSI_PERIOD = 14;
const DEFAULT_STRATEGY_ATR_PERIOD = 14;
const DEFAULT_STRATEGY_MIN_REWARD_RISK = 1.5;
const DEFAULT_STRATEGY_MAX_SPREAD_PIPS = 3;
const DEFAULT_STRATEGY_MIN_ATR_PIPS = 2;
const DEFAULT_STRATEGY_STOP_ATR_MULTIPLIER = 1.5;
const DEFAULT_STRATEGY_QUOTE_MAX_AGE_SECONDS = 120;
const DEFAULT_CLAUDE_BASE_URL = "https://api.anthropic.com";
const DEFAULT_CLAUDE_MODEL = "claude-3-5-haiku-latest";
const DEFAULT_CLAUDE_TIMEOUT_MS = 12_000;
const DEFAULT_CLAUDE_MAX_RETRIES = 1;
const DEFAULT_CLAUDE_MAX_OUTPUT_TOKENS = 1_200;
const DEFAULT_BBC_FEED_URL = "https://feeds.bbci.co.uk/news/business/rss.xml";
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3.5-super-vl:free";
const DEFAULT_AI_RATE_LIMIT_WINDOW_SECONDS = 60;
const DEFAULT_AI_RATE_LIMIT_MAX_REQUESTS = 10;
const DEFAULT_RISK_MAX_EQUITY_RISK_FRACTION = 0.0025;
const DEFAULT_RISK_DAILY_LOSS_FRACTION = 0.01;
const DEFAULT_RISK_MAX_OPEN_POSITIONS = 2;
const DEFAULT_RISK_MIN_REWARD_RISK = 1.5;
const DEFAULT_RISK_COOLING_LOSSES = 3;
const DEFAULT_RISK_COOLING_SECONDS = 86_400;
const DEFAULT_RISK_MAX_QUOTE_AGE_SECONDS = 120;
const DEFAULT_RISK_MAX_PRICE_DRIFT_PIPS = 5;
const DEFAULT_RISK_TIME_ZONE = "UTC";
const DEFAULT_WORKER_HEARTBEAT_INTERVAL_SECONDS = 30;
const DEFAULT_WORKER_POLL_INTERVAL_SECONDS = 15;
const DEFAULT_WORKER_MAX_BACKOFF_SECONDS = 300;
const DEFAULT_MIRRO_BASE_URL = "https://api.mirroapi.cloud/v1";
const DEFAULT_MIRRO_TIMEOUT_MS = 10_000;
const DEFAULT_SUPABASE_AUTH_TIMEOUT_MS = 8_000;
const SUPABASE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readEnv(env, key) {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
}

function parsePositiveInteger(value, key, minimum, maximum, fallback) {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) throw new ConfigurationError(`${key} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ConfigurationError(`${key} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseBoundedNumber(value, key, minimum, maximum, fallback) {
  if (!value) return fallback;
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) throw new ConfigurationError(`${key} must be a positive number`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw new ConfigurationError(`${key} must be between ${minimum} and ${maximum}`);
  return parsed;
}

const VALID_POSTGRES_SSL_MODES = new Set(["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]);

function parseDatabaseUrl(value, key, appEnv = "development") {
  if (!value) return "";
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigurationError(`${key} must be a valid PostgreSQL connection URL`);
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || !parsed.username || !parsed.pathname || parsed.pathname === "/") {
    throw new ConfigurationError(`${key} must be a valid PostgreSQL connection URL`);
  }
  if (parsed.hostname.toLowerCase().endsWith(".neon.tech")) {
    throw new ConfigurationError(`${key} points to a legacy Neon host; configure your Supabase PostgreSQL URL`);
  }
  const sslMode = (parsed.searchParams.get("sslmode") || "").trim().toLowerCase();
  if (sslMode && !VALID_POSTGRES_SSL_MODES.has(sslMode)) {
    throw new ConfigurationError(`${key} has an unsupported sslmode parameter`);
  }
  if (appEnv === "production" && (sslMode === "disable" || sslMode === "allow")) {
    throw new ConfigurationError(`${key} must require TLS in production`);
  }
  return value;
}

function parseHttpUrl(value, key, fallback) {
  const candidate = value || fallback;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ConfigurationError(`${key} must be a valid HTTP(S) URL`);
  }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ConfigurationError(`${key} must contain only an HTTP(S) origin`);
  }
  return parsed.origin;
}

function parseFeedUrl(value, key, fallback, httpsOnly = false) {
  const candidate = value || fallback;
  let parsed;
  try { parsed = new URL(candidate); } catch { throw new ConfigurationError(`${key} must be a valid feed URL`); }
  if (!/^https?:$/.test(parsed.protocol) || (httpsOnly && parsed.protocol !== "https:") || parsed.username || parsed.password || parsed.hash) throw new ConfigurationError(`${key} must be a valid feed URL`);
  return parsed.toString();
}

function parseHttpsBaseUrl(value, key, fallback) {
  const candidate = value || fallback;
  let parsed;
  try { parsed = new URL(candidate); } catch { throw new ConfigurationError(`${key} must be a valid HTTPS URL`); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) throw new ConfigurationError(`${key} must be a valid HTTPS URL`);
  return parsed.toString().replace(/\/$/, "");
}

function parseBoolean(value, key, fallback = false) {
  if (!value) return fallback;
  if (!["true", "false"].includes(value.toLowerCase())) throw new ConfigurationError(`${key} must be true or false`);
  return value.toLowerCase() === "true";
}

function parseWorkerId(value) {
  if (!value) return "local-worker";
  if (value.length < 3 || value.length > 128 || !/^[A-Za-z0-9._-]+$/.test(value)) throw new ConfigurationError("WORKER_ID must be 3-128 safe characters");
  return value;
}

function parseCsv(value, key) {
  if (!value) return Object.freeze([]);
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (!values.length || values.some((item) => item.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(item))) throw new ConfigurationError(`${key} contains an invalid value`);
  return Object.freeze([...new Set(values)]);
}

function assertNotServiceRoleKey(anonKey) {
  if (/^sb_secret_/i.test(anonKey)) {
    throw new ConfigurationError("SUPABASE_ANON_KEY must be an anonymous or publishable key, never a secret key");
  }
  const segments = anonKey.split(".");
  if (segments.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
      if (payload?.role === "service_role" || payload?.role === "supabase_admin") {
        throw new ConfigurationError("SUPABASE_ANON_KEY must not be a service_role key");
      }
    } catch (error) {
      if (error instanceof ConfigurationError) throw error;
    }
  }
}

function parseSupabaseConfig(env, appEnv) {
  if (readEnv(env, "SUPABASE_SERVICE_ROLE_KEY") || readEnv(env, "SUPABASE_SECRET_KEY")) {
    throw new ConfigurationError("Supabase service-role or secret keys must not be configured; use SUPABASE_ANON_KEY only");
  }

  const rawUrl = readEnv(env, "SUPABASE_URL");
  const anonKey = readEnv(env, "SUPABASE_ANON_KEY");
  const ownerUserId = readEnv(env, "SUPABASE_OWNER_USER_ID");
  const timeoutMs = parsePositiveInteger(
    readEnv(env, "SUPABASE_AUTH_TIMEOUT_MS"),
    "SUPABASE_AUTH_TIMEOUT_MS",
    500,
    30_000,
    DEFAULT_SUPABASE_AUTH_TIMEOUT_MS
  );

  const anySet = Boolean(rawUrl || anonKey || ownerUserId);
  const allSet = Boolean(rawUrl && anonKey && ownerUserId);

  if (!anySet) {
    if (appEnv === "production") {
      throw new ConfigurationError("SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_OWNER_USER_ID are required in production");
    }
    return Object.freeze({
      url: "",
      anonKey: "",
      ownerUserId: "",
      timeoutMs,
      configured: false
    });
  }

  if (!allSet) {
    if (appEnv === "production") {
      throw new ConfigurationError("SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_OWNER_USER_ID are required in production");
    }
    throw new ConfigurationError("SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_OWNER_USER_ID must all be set together");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new ConfigurationError("SUPABASE_URL must be a valid URL");
  }
  const isLocalHttp = appEnv !== "production" && parsedUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsedUrl.hostname);
  if ((parsedUrl.protocol !== "https:" && !isLocalHttp) || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash || parsedUrl.pathname !== "/") {
    throw new ConfigurationError("SUPABASE_URL must be a clean HTTPS project origin");
  }

  if (anonKey.length < 16 || anonKey.length > 2_048 || !/^[A-Za-z0-9._-]+$/.test(anonKey)) {
    throw new ConfigurationError("SUPABASE_ANON_KEY is invalid");
  }
  assertNotServiceRoleKey(anonKey);

  if (!SUPABASE_UUID_PATTERN.test(ownerUserId)) {
    throw new ConfigurationError("SUPABASE_OWNER_USER_ID must be a valid UUID");
  }

  return Object.freeze({
    url: parsedUrl.origin,
    anonKey,
    ownerUserId: ownerUserId.toLowerCase(),
    timeoutMs,
    configured: true
  });
}

export class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export function loadConfig(env = process.env) {
  const appEnv = readEnv(env, "APP_ENV") || "development";
  if (!["development", "test", "production"].includes(appEnv)) {
    throw new ConfigurationError("APP_ENV must be development, test, or production");
  }

  const appOrigin = readEnv(env, "APP_ORIGIN") || DEFAULT_APP_ORIGIN;
  let parsedOrigin;
  try {
    parsedOrigin = new URL(appOrigin);
  } catch {
    throw new ConfigurationError("APP_ORIGIN must be a valid absolute URL");
  }
  if (!/^https?:$/.test(parsedOrigin.protocol) || parsedOrigin.pathname !== "/" || parsedOrigin.search || parsedOrigin.hash) {
    throw new ConfigurationError("APP_ORIGIN must contain only an HTTP(S) origin");
  }

  const tradingMode = readEnv(env, "TRADING_MODE") || "disabled";
  if (!["disabled", "simulation"].includes(tradingMode)) {
    throw new ConfigurationError("TRADING_MODE must be disabled or simulation");
  }
  if (readEnv(env, "LIVE_TRADING_ENABLED").toLowerCase() === "true") {
    throw new ConfigurationError("LIVE_TRADING_ENABLED cannot be true in Milestone 2");
  }

  const supabase = parseSupabaseConfig(env, appEnv);
  const hasCompleteAuth = supabase.configured;

  const sessionSecret = readEnv(env, "SESSION_SECRET");
  if (hasCompleteAuth && !sessionSecret) {
    throw new ConfigurationError("SESSION_SECRET is required when authentication is configured");
  }
  if (sessionSecret && Buffer.byteLength(sessionSecret, "utf8") < 32) {
    throw new ConfigurationError("SESSION_SECRET must contain at least 32 bytes");
  }

  const databaseUrl = parseDatabaseUrl(readEnv(env, "DATABASE_URL"), "DATABASE_URL", appEnv);
  const explicitDirectUrl = parseDatabaseUrl(readEnv(env, "DIRECT_URL"), "DIRECT_URL", appEnv);
  const unpooledDatabaseUrl = parseDatabaseUrl(readEnv(env, "DATABASE_URL_UNPOOLED"), "DATABASE_URL_UNPOOLED", appEnv);
  if (explicitDirectUrl && unpooledDatabaseUrl && explicitDirectUrl !== unpooledDatabaseUrl) {
    throw new ConfigurationError("DIRECT_URL and DATABASE_URL_UNPOOLED must match when both are set");
  }
  const databaseDirectUrl = explicitDirectUrl || unpooledDatabaseUrl;
  if (appEnv === "production" && !databaseUrl) {
    throw new ConfigurationError("DATABASE_URL is required in production");
  }
  const configuredProxyMode = readEnv(env, "TRUSTED_PROXY_MODE");
  const trustedProxyMode = configuredProxyMode || (appEnv === "production" ? "none" : "platform");
  if (!["none", "platform"].includes(trustedProxyMode)) throw new ConfigurationError("TRUSTED_PROXY_MODE must be none or platform");

  const workerEnabled = parseBoolean(readEnv(env, "WORKER_ENABLED"), "WORKER_ENABLED");
  if (workerEnabled && !databaseUrl) throw new ConfigurationError("DATABASE_URL is required when WORKER_ENABLED is true");
  const worker = Object.freeze({
    enabled: workerEnabled,
    id: parseWorkerId(readEnv(env, "WORKER_ID")),
    heartbeatIntervalSeconds: parsePositiveInteger(readEnv(env, "WORKER_HEARTBEAT_INTERVAL_SECONDS"), "WORKER_HEARTBEAT_INTERVAL_SECONDS", 15, 3_600, DEFAULT_WORKER_HEARTBEAT_INTERVAL_SECONDS),
    pollIntervalSeconds: parsePositiveInteger(readEnv(env, "WORKER_POLL_INTERVAL_SECONDS"), "WORKER_POLL_INTERVAL_SECONDS", 5, 3_600, DEFAULT_WORKER_POLL_INTERVAL_SECONDS),
    maxBackoffSeconds: parsePositiveInteger(readEnv(env, "WORKER_MAX_BACKOFF_SECONDS"), "WORKER_MAX_BACKOFF_SECONDS", 5, 3_600, DEFAULT_WORKER_MAX_BACKOFF_SECONDS)
  });
  const mt5DemoMode = parseBoolean(readEnv(env, "MT5_DEMO_MODE"), "MT5_DEMO_MODE");
  const mt5ExecutionEnabled = parseBoolean(readEnv(env, "MT5_EXECUTION_ENABLED"), "MT5_EXECUTION_ENABLED");
  if (mt5ExecutionEnabled) throw new ConfigurationError("MT5_EXECUTION_ENABLED cannot be true in Milestone 12");
  const mt5AllowedAccountLogins = parseCsv(readEnv(env, "MT5_ALLOWED_ACCOUNT_LOGINS"), "MT5_ALLOWED_ACCOUNT_LOGINS");
  const mt5AllowedServers = parseCsv(readEnv(env, "MT5_ALLOWED_SERVERS"), "MT5_ALLOWED_SERVERS");
  if (mt5DemoMode && (!mt5AllowedAccountLogins.length || !mt5AllowedServers.length)) throw new ConfigurationError("MT5 demo mode requires account and server allowlists");
  const mt5Connector = readEnv(env, "MT5_CONNECTOR") || "none";
  if (!["none", "mirro"].includes(mt5Connector)) throw new ConfigurationError("MT5_CONNECTOR must be none or mirro");
  const mirroApiKey = readEnv(env, "MIRRO_API_KEY");
  const mirroAccountId = readEnv(env, "MIRRO_ACCOUNT_ID");
  if (mirroApiKey.length > 512 || /[\u0000-\u001f\u007f]/.test(mirroApiKey)) throw new ConfigurationError("MIRRO_API_KEY is invalid");
  if (mirroAccountId.length > 128 || (mirroAccountId && !/^[A-Za-z0-9_-]+$/.test(mirroAccountId))) throw new ConfigurationError("MIRRO_ACCOUNT_ID is invalid");
  const mirroBaseUrl = parseHttpsBaseUrl(readEnv(env, "MIRRO_API_BASE_URL"), "MIRRO_API_BASE_URL", DEFAULT_MIRRO_BASE_URL);
  const mt5 = Object.freeze({ enabled: mt5DemoMode, demoMode: mt5DemoMode, executionEnabled: false, connector: mt5Connector, allowedAccountLogins: mt5AllowedAccountLogins, allowedServers: mt5AllowedServers, mirro: Object.freeze({ apiKey: mirroApiKey, accountId: mirroAccountId, baseUrl: mirroBaseUrl, configured: mt5Connector === "mirro" && Boolean(mirroApiKey && mirroAccountId), timeoutMs: parsePositiveInteger(readEnv(env, "MIRRO_TIMEOUT_MS"), "MIRRO_TIMEOUT_MS", 500, 30_000, DEFAULT_MIRRO_TIMEOUT_MS) }) });

  const marketDataProvider = readEnv(env, "MARKET_DATA_PROVIDER") || "none";
  if (!["none", "twelvedata"].includes(marketDataProvider)) {
    throw new ConfigurationError("MARKET_DATA_PROVIDER must be none or twelvedata");
  }
  const marketDataApiKey = readEnv(env, "TWELVE_DATA_API_KEY");
  if (marketDataApiKey.length > 256 || /[\u0000-\u001f\u007f]/.test(marketDataApiKey)) {
    throw new ConfigurationError("TWELVE_DATA_API_KEY is invalid");
  }

  const anthropicApiKey = readEnv(env, "ANTHROPIC_API_KEY");
  if (anthropicApiKey.length > 512 || /[\u0000-\u001f\u007f]/.test(anthropicApiKey)) throw new ConfigurationError("ANTHROPIC_API_KEY is invalid");
  const claudeModel = readEnv(env, "ANTHROPIC_MODEL") || DEFAULT_CLAUDE_MODEL;
  if (claudeModel.length < 1 || claudeModel.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(claudeModel)) throw new ConfigurationError("ANTHROPIC_MODEL is invalid");
  const aiProvider = readEnv(env, "AI_PROVIDER") || "anthropic";
  if (!["anthropic", "openrouter"].includes(aiProvider)) throw new ConfigurationError("AI_PROVIDER must be anthropic or openrouter");
  const openRouterApiKey = readEnv(env, "OPENROUTER_API_KEY");
  if (openRouterApiKey.length > 512 || /[\u0000-\u001f\u007f]/.test(openRouterApiKey)) throw new ConfigurationError("OPENROUTER_API_KEY is invalid");
  const openRouterModel = readEnv(env, "OPENROUTER_MODEL") || DEFAULT_OPENROUTER_MODEL;
  if (openRouterModel.length < 1 || openRouterModel.length > 128 || !/^[A-Za-z0-9._:/-]+$/.test(openRouterModel)) throw new ConfigurationError("OPENROUTER_MODEL is invalid");
  const openRouterBaseUrl = parseHttpsBaseUrl(readEnv(env, "OPENROUTER_BASE_URL"), "OPENROUTER_BASE_URL", DEFAULT_OPENROUTER_BASE_URL);
  const newsProvider = readEnv(env, "NEWS_PROVIDER") || "none";
  if (!["none", "json", "bbc"].includes(newsProvider)) throw new ConfigurationError("NEWS_PROVIDER must be none, json, or bbc");
  const newsApiKey = readEnv(env, "NEWS_API_KEY");
  if (newsApiKey.length > 512 || /[\u0000-\u001f\u007f]/.test(newsApiKey)) throw new ConfigurationError("NEWS_API_KEY is invalid");
  const riskTimeZone = readEnv(env, "RISK_TIME_ZONE") || DEFAULT_RISK_TIME_ZONE;
  try { new Intl.DateTimeFormat("en-US", { timeZone: riskTimeZone }).format(); } catch { throw new ConfigurationError("RISK_TIME_ZONE must be a valid IANA time zone"); }

  const strategy = Object.freeze({
    name: "baseline-trend-momentum-v1",
    fastMaPeriod: parsePositiveInteger(readEnv(env, "STRATEGY_FAST_MA_PERIOD"), "STRATEGY_FAST_MA_PERIOD", 2, 50, DEFAULT_STRATEGY_FAST_MA_PERIOD),
    slowMaPeriod: parsePositiveInteger(readEnv(env, "STRATEGY_SLOW_MA_PERIOD"), "STRATEGY_SLOW_MA_PERIOD", 3, 200, DEFAULT_STRATEGY_SLOW_MA_PERIOD),
    rsiPeriod: parsePositiveInteger(readEnv(env, "STRATEGY_RSI_PERIOD"), "STRATEGY_RSI_PERIOD", 5, 50, DEFAULT_STRATEGY_RSI_PERIOD),
    atrPeriod: parsePositiveInteger(readEnv(env, "STRATEGY_ATR_PERIOD"), "STRATEGY_ATR_PERIOD", 5, 50, DEFAULT_STRATEGY_ATR_PERIOD),
    minRewardRisk: parseBoundedNumber(readEnv(env, "STRATEGY_MIN_REWARD_RISK"), "STRATEGY_MIN_REWARD_RISK", 1, 5, DEFAULT_STRATEGY_MIN_REWARD_RISK),
    maxSpreadPips: parseBoundedNumber(readEnv(env, "STRATEGY_MAX_SPREAD_PIPS"), "STRATEGY_MAX_SPREAD_PIPS", 0.1, 100, DEFAULT_STRATEGY_MAX_SPREAD_PIPS),
    minAtrPips: parseBoundedNumber(readEnv(env, "STRATEGY_MIN_ATR_PIPS"), "STRATEGY_MIN_ATR_PIPS", 0.1, 100, DEFAULT_STRATEGY_MIN_ATR_PIPS),
    stopAtrMultiplier: parseBoundedNumber(readEnv(env, "STRATEGY_STOP_ATR_MULTIPLIER"), "STRATEGY_STOP_ATR_MULTIPLIER", 0.5, 5, DEFAULT_STRATEGY_STOP_ATR_MULTIPLIER),
    quoteMaxAgeSeconds: parsePositiveInteger(readEnv(env, "STRATEGY_QUOTE_MAX_AGE_SECONDS"), "STRATEGY_QUOTE_MAX_AGE_SECONDS", 30, 86_400, DEFAULT_STRATEGY_QUOTE_MAX_AGE_SECONDS)
  });
  if (strategy.slowMaPeriod <= strategy.fastMaPeriod) throw new ConfigurationError("STRATEGY_SLOW_MA_PERIOD must exceed STRATEGY_FAST_MA_PERIOD");

  return Object.freeze({
    appEnv,
    appOrigin: parsedOrigin.origin,
    trustedProxy: Object.freeze({ mode: trustedProxyMode }),
    tradingMode,
    liveTradingEnabled: false,
    auth: Object.freeze({ provider: "supabase", configured: hasCompleteAuth }),
    supabase,
    sessionSecret: sessionSecret || "development-only-session-secret-change-me",
    database: Object.freeze({
      url: databaseUrl,
      directUrl: databaseDirectUrl,
      configured: Boolean(databaseUrl),
      queryTimeoutMs: parsePositiveInteger(readEnv(env, "DATABASE_QUERY_TIMEOUT_MS"), "DATABASE_QUERY_TIMEOUT_MS", 500, 30_000, DEFAULT_DATABASE_QUERY_TIMEOUT_MS)
    }),
    worker,
    mt5,
    marketData: Object.freeze({
      provider: marketDataProvider,
      apiKey: marketDataApiKey,
      baseUrl: parseHttpUrl(readEnv(env, "MARKET_DATA_BASE_URL"), "MARKET_DATA_BASE_URL", DEFAULT_MARKET_DATA_BASE_URL),
      configured: marketDataProvider !== "none" && Boolean(marketDataApiKey),
      timeoutMs: parsePositiveInteger(readEnv(env, "MARKET_DATA_TIMEOUT_MS"), "MARKET_DATA_TIMEOUT_MS", 500, 30_000, DEFAULT_MARKET_DATA_TIMEOUT_MS),
      maxRetries: parsePositiveInteger(readEnv(env, "MARKET_DATA_MAX_RETRIES"), "MARKET_DATA_MAX_RETRIES", 0, 2, DEFAULT_MARKET_DATA_MAX_RETRIES),
      cacheSeconds: parsePositiveInteger(readEnv(env, "MARKET_DATA_CACHE_SECONDS"), "MARKET_DATA_CACHE_SECONDS", 0, 60, DEFAULT_MARKET_DATA_CACHE_SECONDS),
      maxCandles: parsePositiveInteger(readEnv(env, "MARKET_DATA_MAX_CANDLES"), "MARKET_DATA_MAX_CANDLES", 10, 500, DEFAULT_MARKET_DATA_MAX_CANDLES),
      quoteStaleSeconds: parsePositiveInteger(readEnv(env, "MARKET_DATA_QUOTE_STALE_SECONDS"), "MARKET_DATA_QUOTE_STALE_SECONDS", 30, 86_400, DEFAULT_MARKET_DATA_QUOTE_STALE_SECONDS),
      rateLimitWindowSeconds: parsePositiveInteger(readEnv(env, "MARKET_DATA_RATE_LIMIT_WINDOW_SECONDS"), "MARKET_DATA_RATE_LIMIT_WINDOW_SECONDS", 10, 3_600, DEFAULT_MARKET_DATA_RATE_LIMIT_WINDOW_SECONDS),
      rateLimitMaxRequests: parsePositiveInteger(readEnv(env, "MARKET_DATA_RATE_LIMIT_MAX_REQUESTS"), "MARKET_DATA_RATE_LIMIT_MAX_REQUESTS", 1, 600, DEFAULT_MARKET_DATA_RATE_LIMIT_MAX_REQUESTS)
    }),
    claude: Object.freeze({
      apiKey: anthropicApiKey,
      model: claudeModel,
      baseUrl: parseHttpUrl(readEnv(env, "ANTHROPIC_BASE_URL"), "ANTHROPIC_BASE_URL", DEFAULT_CLAUDE_BASE_URL),
      configured: Boolean(anthropicApiKey),
      timeoutMs: parsePositiveInteger(readEnv(env, "ANTHROPIC_TIMEOUT_MS"), "ANTHROPIC_TIMEOUT_MS", 1_000, 30_000, DEFAULT_CLAUDE_TIMEOUT_MS),
      maxRetries: parsePositiveInteger(readEnv(env, "ANTHROPIC_MAX_RETRIES"), "ANTHROPIC_MAX_RETRIES", 0, 1, DEFAULT_CLAUDE_MAX_RETRIES),
      maxOutputTokens: parsePositiveInteger(readEnv(env, "ANTHROPIC_MAX_OUTPUT_TOKENS"), "ANTHROPIC_MAX_OUTPUT_TOKENS", 256, 2_000, DEFAULT_CLAUDE_MAX_OUTPUT_TOKENS),
      rateLimitWindowSeconds: parsePositiveInteger(readEnv(env, "AI_RATE_LIMIT_WINDOW_SECONDS"), "AI_RATE_LIMIT_WINDOW_SECONDS", 10, 3_600, DEFAULT_AI_RATE_LIMIT_WINDOW_SECONDS),
      rateLimitMaxRequests: parsePositiveInteger(readEnv(env, "AI_RATE_LIMIT_MAX_REQUESTS"), "AI_RATE_LIMIT_MAX_REQUESTS", 1, 60, DEFAULT_AI_RATE_LIMIT_MAX_REQUESTS)
    }),
    aiProvider,
    openrouter: Object.freeze({ apiKey: openRouterApiKey, model: openRouterModel, baseUrl: openRouterBaseUrl, configured: Boolean(openRouterApiKey), timeoutMs: parsePositiveInteger(readEnv(env, "OPENROUTER_TIMEOUT_MS"), "OPENROUTER_TIMEOUT_MS", 1_000, 30_000, DEFAULT_CLAUDE_TIMEOUT_MS), maxRetries: 0, maxOutputTokens: parsePositiveInteger(readEnv(env, "OPENROUTER_MAX_OUTPUT_TOKENS"), "OPENROUTER_MAX_OUTPUT_TOKENS", 256, 2_000, DEFAULT_CLAUDE_MAX_OUTPUT_TOKENS) }),
    news: Object.freeze({ provider: newsProvider, apiKey: newsApiKey, feedUrl: newsProvider === "bbc" ? parseFeedUrl(readEnv(env, "NEWS_FEED_URL"), "NEWS_FEED_URL", DEFAULT_BBC_FEED_URL, true) : parseHttpUrl(readEnv(env, "NEWS_FEED_URL"), "NEWS_FEED_URL", "http://localhost:3000"), configured: newsProvider === "bbc" ? Boolean(readEnv(env, "NEWS_FEED_URL") || DEFAULT_BBC_FEED_URL) : newsProvider !== "none" && Boolean(newsApiKey) }),
    risk: Object.freeze({
      version: "risk-baseline-v1",
      maxEquityRiskFraction: parseBoundedNumber(readEnv(env, "RISK_MAX_EQUITY_FRACTION"), "RISK_MAX_EQUITY_FRACTION", 0.0001, 0.01, DEFAULT_RISK_MAX_EQUITY_RISK_FRACTION),
      dailyLossHaltFraction: parseBoundedNumber(readEnv(env, "RISK_DAILY_LOSS_HALT_FRACTION"), "RISK_DAILY_LOSS_HALT_FRACTION", 0.001, 0.1, DEFAULT_RISK_DAILY_LOSS_FRACTION),
      maxOpenPositions: parsePositiveInteger(readEnv(env, "RISK_MAX_OPEN_POSITIONS"), "RISK_MAX_OPEN_POSITIONS", 1, 10, DEFAULT_RISK_MAX_OPEN_POSITIONS),
      minRewardRisk: parseBoundedNumber(readEnv(env, "RISK_MIN_REWARD_RISK"), "RISK_MIN_REWARD_RISK", 1, 5, DEFAULT_RISK_MIN_REWARD_RISK),
      coolingAfterLosses: parsePositiveInteger(readEnv(env, "RISK_COOLING_AFTER_LOSSES"), "RISK_COOLING_AFTER_LOSSES", 1, 10, DEFAULT_RISK_COOLING_LOSSES),
      coolingSeconds: parsePositiveInteger(readEnv(env, "RISK_COOLING_SECONDS"), "RISK_COOLING_SECONDS", 300, 604_800, DEFAULT_RISK_COOLING_SECONDS),
      maxQuoteAgeSeconds: parsePositiveInteger(readEnv(env, "RISK_MAX_QUOTE_AGE_SECONDS"), "RISK_MAX_QUOTE_AGE_SECONDS", 30, 86_400, DEFAULT_RISK_MAX_QUOTE_AGE_SECONDS),
      maxPriceDriftPips: parseBoundedNumber(readEnv(env, "RISK_MAX_PRICE_DRIFT_PIPS"), "RISK_MAX_PRICE_DRIFT_PIPS", 0.1, 100, DEFAULT_RISK_MAX_PRICE_DRIFT_PIPS),
      timeZone: riskTimeZone,
      tradingDayConvention: "calendar_day_in_configured_time_zone"
    }),
    strategy,
    sessionTtlSeconds: parsePositiveInteger(readEnv(env, "SESSION_TTL_SECONDS"), "SESSION_TTL_SECONDS", 300, 86_400, DEFAULT_SESSION_TTL_SECONDS),
    rateLimitWindowSeconds: parsePositiveInteger(readEnv(env, "AUTH_RATE_LIMIT_WINDOW_SECONDS"), "AUTH_RATE_LIMIT_WINDOW_SECONDS", 60, 86_400, DEFAULT_RATE_LIMIT_WINDOW_SECONDS),
    rateLimitMaxAttempts: parsePositiveInteger(readEnv(env, "AUTH_RATE_LIMIT_MAX_ATTEMPTS"), "AUTH_RATE_LIMIT_MAX_ATTEMPTS", 1, 20, DEFAULT_RATE_LIMIT_MAX_ATTEMPTS)
  });
}

export const configDefaults = Object.freeze({
  appOrigin: DEFAULT_APP_ORIGIN,
  sessionTtlSeconds: DEFAULT_SESSION_TTL_SECONDS,
  rateLimitWindowSeconds: DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
  rateLimitMaxAttempts: DEFAULT_RATE_LIMIT_MAX_ATTEMPTS
});
