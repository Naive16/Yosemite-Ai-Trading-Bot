import { ConfigurationError, loadConfig } from "./config.js";

function isHttpsOrigin(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function isTransactionPooledDatabaseUrl(value) {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    const pgbouncer = (parsed.searchParams.get("pgbouncer") || "").trim().toLowerCase();
    return parsed.port === "6543" || pgbouncer === "true" || hostname.includes("-pooler.");
  } catch {
    return false;
  }
}

export function isLegacyNeonDatabaseUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase().endsWith(".neon.tech");
  } catch {
    return false;
  }
}

/**
 * Validate deployment-only invariants without returning any secret values.
 * This is deliberately separate from loadConfig so local development remains
 * usable while production deployment remains fail-closed.
 */
export function inspectDeploymentConfig(env = process.env) {
  const failures = [];
  const warnings = [];
  let config;

  try {
    config = loadConfig(env);
  } catch (error) {
    failures.push(error instanceof ConfigurationError ? error.message : "Configuration could not be loaded");
    return Object.freeze({ ready: false, failures: Object.freeze(failures), warnings: Object.freeze(warnings) });
  }

  if (config.appEnv !== "production") failures.push("APP_ENV must be production for a deployment");
  if (!isHttpsOrigin(config.appOrigin)) failures.push("APP_ORIGIN must be an HTTPS origin for a deployment");
  if (!config.database.configured) failures.push("DATABASE_URL must be configured for a deployment");
  if (config.database.url && isLegacyNeonDatabaseUrl(config.database.url)) {
    failures.push("DATABASE_URL points to a legacy Neon host; configure your Supabase PostgreSQL URL");
  }
  if (!config.database.directUrl) {
    warnings.push("DIRECT_URL (or DATABASE_URL_UNPOOLED) is not configured; migrations require a Supabase Session Mode (:5432) or Direct (:5432) PostgreSQL URL");
  }
  if (config.database.directUrl && isLegacyNeonDatabaseUrl(config.database.directUrl)) {
    failures.push("DIRECT_URL / DATABASE_URL_UNPOOLED points to a legacy Neon host; configure a Supabase Session Mode (:5432) or Direct (:5432) PostgreSQL URL");
  }
  if (config.database.directUrl && isTransactionPooledDatabaseUrl(config.database.directUrl)) {
    failures.push("DIRECT_URL / DATABASE_URL_UNPOOLED must be a direct, non-pooled or session-mode (:5432) PostgreSQL URL, not a transaction pooler (:6543)");
  }
  if (config.tradingMode !== "disabled") failures.push("TRADING_MODE must remain disabled for this deployment milestone");
  if (config.liveTradingEnabled) failures.push("Live trading must remain disabled");
  if (config.worker.enabled) failures.push("WORKER_ENABLED must remain false on the request-driven dashboard deployment");
  if (config.mt5.executionEnabled) failures.push("MT5 execution must remain disabled");
  if (config.trustedProxy.mode === "none") warnings.push("TRUSTED_PROXY_MODE=none is fail-closed; set platform only after the deployment proxy is confirmed");
  warnings.push("Shared rate limiting and Supabase RLS hardening require migrations 001 through 008 to be applied and verified on the target Supabase database");

  return Object.freeze({ ready: failures.length === 0, failures: Object.freeze(failures), warnings: Object.freeze(warnings) });
}
