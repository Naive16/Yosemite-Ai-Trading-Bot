import { ConfigurationError, loadConfig } from "./config.js";

function isHttpsOrigin(value) {
  try {
    return new URL(value).protocol === "https:";
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
  if (!config.supabase.configured) failures.push("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be configured for a deployment");
  if (config.tradingMode !== "disabled") failures.push("TRADING_MODE must remain disabled for this deployment milestone");
  if (config.liveTradingEnabled) failures.push("Live trading must remain disabled");
  if (config.worker.enabled) failures.push("WORKER_ENABLED must remain false on the request-driven dashboard deployment");
  if (config.mt5.executionEnabled) failures.push("MT5 execution must remain disabled");
  if (config.trustedProxy.mode === "none") warnings.push("TRUSTED_PROXY_MODE=none is fail-closed; set platform only after the deployment proxy is confirmed");
  warnings.push("External verification required: inspect the existing Supabase schema, review the Supabase migration, membership mapping, session verification and RLS before production deployment");
  warnings.push("Disable Supabase public signup; invite approved operators and configure exact Site URL and recovery redirect URLs");

  return Object.freeze({ ready: failures.length === 0, failures: Object.freeze(failures), warnings: Object.freeze(warnings) });
}
