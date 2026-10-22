import { loadConfig, ConfigurationError } from "../_lib/config.js";
import { getSession } from "../_lib/auth.js";
import { DatabaseConfigurationError, DatabaseQueryError, getDatabase } from "../_lib/database.js";
import { insertAuditEvent } from "../_lib/repository.js";
import { sendJson, methodNotAllowed } from "../_lib/http.js";
import { checkRiskRateLimit } from "../_lib/risk/rate-limit.js";
import { evaluateRisk } from "../_lib/risk/engine.js";
import { RateLimitUnavailableError } from "../_lib/rate-limit.js";

function unavailable(response, code = "risk_state_unavailable", status = 503) { return sendJson(response, status, { status: "unavailable", decision: "BLOCKED", code, message: "Risk evaluation is blocked because trusted risk state is unavailable", executionAllowed: false, tradingEnabled: false }); }

export default async function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, "GET");
  let config; try { config = loadConfig(); } catch (error) { if (error instanceof ConfigurationError) return unavailable(response, "configuration_invalid"); throw error; }
  if (!config.auth.configured) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" });
  if (!config.database.configured) return unavailable(response, "database_unavailable");
  let db; let session;
  try { db = getDatabase(); session = await getSession(request, db, config); } catch (error) { if (error instanceof DatabaseConfigurationError || error instanceof DatabaseQueryError) return unavailable(response, "database_unavailable"); throw error; }
  if (!session) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" });
  let limit;
  try { limit = await checkRiskRateLimit(db, request, config, session.userId); } catch (error) {
    if (error instanceof RateLimitUnavailableError) return unavailable(response, "rate_limiter_unavailable");
    throw error;
  }
  if (!limit.allowed) return sendJson(response, 429, { status: "error", code: "rate_limited", message: "Risk evaluation rate limit reached" }, { "Retry-After": String(limit.retryAfterSeconds) });
  const evaluation = evaluateRisk({ candidate: null, account: null, instrument: null, quote: null, exposure: null, riskConfig: config.risk });
  try { await insertAuditEvent(db, { userId: session.userId, eventType: "risk.evaluation.blocked", metadata: { decision: evaluation.decision, reasonCodes: evaluation.reasonCodes, engineVersion: evaluation.engine.version } }); } catch (error) { if (error instanceof DatabaseConfigurationError || error instanceof DatabaseQueryError) return unavailable(response, "risk_audit_unavailable"); throw error; }
  return sendJson(response, 200, { status: "ok", evaluation, message: "No trusted account, position, instrument, or quote source is configured; no risk pass is possible" });
}
