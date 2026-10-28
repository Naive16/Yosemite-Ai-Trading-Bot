import { methodNotAllowed, sendJson } from "./_lib/http.js";
import { loadConfig } from "./_lib/config.js";
import { runtimeEnv } from "./_lib/runtime.js";

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
  try {
    const config = loadConfig(runtimeEnv(request));
    return sendJson(response, 200, foundationResponse(config));
  } catch {
    return sendJson(response, 503, { status: "unavailable", code: "configuration_invalid", message: "Service configuration unavailable", tradingEnabled: false, liveTradingEnabled: false });
  }
}

export { foundationResponse };
