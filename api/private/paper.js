import { loadConfig, ConfigurationError } from "../_lib/config.js";
import { AuthError, csrfMatches, getSession } from "../_lib/auth.js";
import { DatabaseConfigurationError, DatabaseQueryError, getDatabase } from "../_lib/database.js";
import { sendJson, methodNotAllowed } from "../_lib/http.js";
import { assertSameOrigin, InputValidationError, parseJsonBody } from "../_lib/validation.js";
import { checkRiskRateLimit } from "../_lib/risk/rate-limit.js";
import { RateLimitUnavailableError } from "../_lib/rate-limit.js";
import { runtimeEnv } from "../_lib/runtime.js";

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed(response, "GET, POST");
  let config; try { config = loadConfig(runtimeEnv(request)); } catch (error) { if (error instanceof ConfigurationError) return sendJson(response, 503, { status: "unavailable", mode: "paper_simulation", code: "configuration_invalid", message: "Paper simulation is unavailable" }); throw error; }
  if (!config.auth.configured) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" }); if (!config.database.configured) return sendJson(response, 503, { status: "unavailable", mode: "paper_simulation", code: "database_unavailable", message: "Paper simulation is unavailable" });
  let session; let db; try { db = getDatabase(runtimeEnv(request)); session = await getSession(request, db, config); } catch (error) { if (error instanceof AuthError) return sendJson(response, error.status, { status: "error", code: error.code, message: error.message }); if (error instanceof DatabaseConfigurationError || error instanceof DatabaseQueryError) return sendJson(response, 503, { status: "unavailable", mode: "paper_simulation", code: "database_unavailable", message: "Paper simulation is unavailable" }); throw error; }
  if (!session) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" });
  let limit; try { limit = await checkRiskRateLimit(db, request, config, session.userId); } catch (error) { if (error instanceof AuthError) return sendJson(response, error.status, { status: "error", code: error.code, message: error.message }); if (error instanceof RateLimitUnavailableError) return sendJson(response, 503, { status: "unavailable", mode: "paper_simulation", code: "rate_limiter_unavailable", message: "Paper simulation is unavailable" }); throw error; }
  if (!limit.allowed) return sendJson(response, 429, { status: "error", code: "rate_limited", message: "Paper simulation rate limit reached" }, { "Retry-After": String(limit.retryAfterSeconds) });
  if (request.method === "POST") { try { assertSameOrigin(request, config.appOrigin); if (!csrfMatches(request, session)) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" }); const body = parseJsonBody(request, 1_024); if (body && Object.keys(body).length) return sendJson(response, 400, { status: "error", code: "client_data_not_allowed", message: "Paper events must come from a server-side trusted source" }); } catch (error) { if (error instanceof AuthError) return sendJson(response, error.status, { status: "error", code: error.code, message: error.message }); if (error instanceof InputValidationError) return sendJson(response, 400, { status: "error", code: "invalid_request", message: error.message }); throw error; } }
  return sendJson(response, 200, { status: "unavailable", mode: "paper_simulation", simulated: true, live: false, running: false, code: "no_persistent_worker_or_live_source", message: "Paper trading is not running; no persistent worker or trusted live source is configured", executionAllowed: false, tradingEnabled: false });
}
