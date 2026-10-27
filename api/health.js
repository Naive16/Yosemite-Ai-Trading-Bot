import { methodNotAllowed, sendJson } from "./_lib/http.js";
import { loadConfig } from "./_lib/config.js";
import { getDatabase } from "./_lib/database.js";
import { runtimeEnv } from "./_lib/runtime.js";

const HEALTH_PROBE_CACHE_TTL_MS = 5_000;
let cachedDatabaseProbe = { checkedAtMs: 0, state: "unknown" };

const foundationResponse = (config = null, databaseState = "unknown") => ({
  status: "ok",
  service: "yosemite-api-foundation",
  mode: "foundation",
  tradingEnabled: false,
  liveTradingEnabled: false,
  services: {
    dashboard: "operational",
    broker: "not_configured",
    marketData: config?.marketData?.configured ? config.marketData.provider : "not_configured",
    database: databaseState,
    aiAnalysis: "not_configured"
  },
  checkedAt: new Date().toISOString()
});

function wantsDatabaseProbe(request) {
  if (!request?.url) return false;
  try {
    return new URL(request.url, "http://localhost").searchParams.get("probe") === "database";
  } catch {
    return false;
  }
}

async function probeDatabaseState(request, config) {
  const useCache = config?.appEnv === "production";
  const now = Date.now();
  if (useCache && now - cachedDatabaseProbe.checkedAtMs < HEALTH_PROBE_CACHE_TTL_MS) {
    return cachedDatabaseProbe.state;
  }
  let state = "unavailable";
  try {
    const db = getDatabase(runtimeEnv(request));
    if (typeof db.ping === "function") await db.ping();
    else await db.query("SELECT 1 AS ok WHERE clock_timestamp() IS NOT NULL", []);
    state = "operational";
  } catch {
    state = "unavailable";
  }
  if (useCache) cachedDatabaseProbe = { checkedAtMs: Date.now(), state };
  return state;
}

export default function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, "GET");
  let config = null;
  try { config = loadConfig(runtimeEnv(request)); } catch { /* Keep health safe when optional configuration is incomplete. */ }
  if (!wantsDatabaseProbe(request)) {
    return sendJson(response, 200, foundationResponse(config));
  }
  if (!config?.database?.configured) {
    return sendJson(response, 200, foundationResponse(config, "not_configured"));
  }
  return probeDatabaseState(request, config).then((dbState) => sendJson(response, 200, foundationResponse(config, dbState)));
}

export { foundationResponse };
