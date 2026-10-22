import { methodNotAllowed, sendJson } from "./_lib/http.js";
import { loadConfig } from "./_lib/config.js";

const foundationResponse = (config = null) => ({
  status: "ok",
  service: "yosemite-api-foundation",
  mode: "foundation",
  tradingEnabled: false,
  liveTradingEnabled: false,
  services: {
    dashboard: "operational",
    broker: "not_configured",
    marketData: config?.marketData?.configured ? config.marketData.provider : "not_configured",
    database: "unknown",
    aiAnalysis: "not_configured"
  },
  checkedAt: new Date().toISOString()
});

export default function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, "GET");
  let config = null;
  try { config = loadConfig(request?.runtimeEnv); } catch { /* Keep health safe when optional configuration is incomplete. */ }
  return sendJson(response, 200, foundationResponse(config));
}

export { foundationResponse };
