import { loadConfig, ConfigurationError } from "../_lib/config.js";
import { csrfMatches, getSession } from "../_lib/auth.js";
import { DatabaseConfigurationError, DatabaseQueryError, getDatabase } from "../_lib/database.js";
import { sendJson, methodNotAllowed } from "../_lib/http.js";
import { assertSameOrigin, InputValidationError, parseJsonBody } from "../_lib/validation.js";
import { createMarketDataProvider } from "../_lib/market-data/provider.js";
import { checkRiskRateLimit } from "../_lib/risk/rate-limit.js";
import { RateLimitUnavailableError } from "../_lib/rate-limit.js";
import { runtimeEnv } from "../_lib/runtime.js";

function unavailable(response, code = "backtest_unavailable") { return sendJson(response, 503, { status: "unavailable", code, mode: "historical_simulation", message: "Backtest cannot run without a configured validated historical source and instrument specifications" }); }
function payload(request) { const body = parseJsonBody(request, 2_048); if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["symbol", "timeframe", "startDate", "endDate"].includes(key))) throw new InputValidationError("Backtest request is invalid"); if (typeof body.symbol !== "string" || typeof body.timeframe !== "string") throw new InputValidationError("Backtest symbol and timeframe are required"); for (const key of ["startDate", "endDate"]) if (body[key] != null && Number.isNaN(new Date(body[key]).getTime())) throw new InputValidationError("Backtest date is invalid"); if (body.startDate && body.endDate && new Date(body.endDate) <= new Date(body.startDate)) throw new InputValidationError("Backtest date range is invalid"); if (body.startDate && body.endDate && new Date(body.endDate) - new Date(body.startDate) > 366 * 86_400_000) throw new InputValidationError("Backtest date range exceeds one year"); return body; }

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed(response, "GET, POST");
  let config; try { config = loadConfig(runtimeEnv(request)); } catch (error) { if (error instanceof ConfigurationError) return unavailable(response, "configuration_invalid"); throw error; }
  if (!config.auth.configured) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" }); if (!config.database.configured) return unavailable(response, "database_unavailable");
  let db; let session; try { db = getDatabase(runtimeEnv(request)); session = await getSession(request, db, config); } catch (error) { if (error instanceof DatabaseConfigurationError || error instanceof DatabaseQueryError) return unavailable(response, "database_unavailable"); throw error; }
  if (!session) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" });
  let limit; try { limit = await checkRiskRateLimit(db, request, config, session.userId); } catch (error) { if (error instanceof RateLimitUnavailableError) return unavailable(response, "rate_limiter_unavailable"); throw error; }
  if (!limit.allowed) return sendJson(response, 429, { status: "error", code: "rate_limited", message: "Simulation request rate limit reached" }, { "Retry-After": String(limit.retryAfterSeconds) });
  try { if (request.method === "POST") { assertSameOrigin(request, config.appOrigin); if (!csrfMatches(request, session)) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" }); payload(request); } const provider = createMarketDataProvider(config); if (!provider.configured) return unavailable(response, "historical_provider_unavailable"); return unavailable(response, "instrument_specs_unavailable"); } catch (error) { if (error instanceof InputValidationError) return sendJson(response, 400, { status: "error", code: "invalid_request", message: error.message }); throw error; }
}
