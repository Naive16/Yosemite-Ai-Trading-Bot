import { loadConfig, ConfigurationError } from "../_lib/config.js";
import { AuthError, getSession } from "../_lib/auth.js";
import { DatabaseConfigurationError, DatabaseQueryError, getDatabase } from "../_lib/database.js";
import { insertAuditEvent } from "../_lib/repository.js";
import { sendJson, methodNotAllowed } from "../_lib/http.js";
import { assertSameOrigin, InputValidationError, parseJsonBody } from "../_lib/validation.js";
import { checkRiskRateLimit } from "../_lib/risk/rate-limit.js";
import { RateLimitUnavailableError } from "../_lib/rate-limit.js";
import { createPaperEngine, PaperValidationError, PaperInsufficientFundsError } from "../_lib/paper/engine.js";
import { runtimeEnv } from "../_lib/runtime.js";

function unavailable(response, code = "paper_unavailable", message = "Paper trading is unavailable") {
  return sendJson(response, 503, { status: "unavailable", mode: "paper_simulation", code, message, simulated: true, live: false, executionAllowed: false, tradingEnabled: false });
}

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed(response, "GET, POST");
  let config;
  try { config = loadConfig(runtimeEnv(request)); } catch (error) {
    if (error instanceof ConfigurationError) return unavailable(response, "configuration_invalid", "Paper simulation is unavailable");
    throw error;
  }
  if (!config.auth.configured) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" });
  if (!config.database.configured) return unavailable(response, "database_unavailable");

  let db; let session;
  try {
    db = getDatabase(runtimeEnv(request));
    session = await getSession(request, db, config);
  } catch (error) {
    if (error instanceof AuthError) return sendJson(response, error.status, { status: "error", code: error.code, message: error.message });
    if (error instanceof DatabaseConfigurationError || error instanceof DatabaseQueryError) return unavailable(response, "database_unavailable");
    throw error;
  }
  if (!session) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" });

  let limit;
  try { limit = await checkRiskRateLimit(db, request, config, session.userId); } catch (error) {
    if (error instanceof AuthError) return sendJson(response, error.status, { status: "error", code: error.code, message: error.message });
    if (error instanceof RateLimitUnavailableError) return unavailable(response, "rate_limiter_unavailable");
    throw error;
  }
  if (!limit.allowed) return sendJson(response, 429, { status: "error", code: "rate_limited", message: "Paper trading rate limit reached" }, { "Retry-After": String(limit.retryAfterSeconds) });

  if (request.method === "GET") {
    try {
      const engine = createPaperEngine(db, { userId: session.userId });
      const state = await engine.load();
      return sendJson(response, 200, {
        status: "ok",
        mode: "paper_simulation",
        simulated: true,
        live: false,
        running: true,
        executionAllowed: false,
        tradingEnabled: false,
        ...state
      });
    } catch (error) {
      if (error instanceof DatabaseConfigurationError || error instanceof DatabaseQueryError) return unavailable(response, "database_unavailable");
      throw error;
    }
  }

  // POST - open or close a paper position
  try {
    assertSameOrigin(request, config.appOrigin);
    const body = parseJsonBody(request, 2_048);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new InputValidationError("Request body must be an object");
    const { action, eventId, proposal, quote, positionId } = body;

    if (action === "open") {
      if (!eventId || typeof eventId !== "string") throw new InputValidationError("Event ID is required");
      if (!proposal || typeof proposal !== "object") throw new InputValidationError("Proposal is required");
      if (!quote || typeof quote !== "object") throw new InputValidationError("Quote is required");

      const engine = createPaperEngine(db, { userId: session.userId });
      await engine.load();
      const result = await engine.openPosition({ eventId, proposal, quote });

      try {
        await insertAuditEvent(db, {
          userId: session.userId,
          eventType: "paper.position.opened",
          metadata: { positionId: result.position.id, symbol: result.position.symbol, direction: result.position.direction, equityAfter: result.equityAfter, simulated: true }
        });
      } catch (auditError) {
        if (auditError instanceof DatabaseConfigurationError || auditError instanceof DatabaseQueryError) return unavailable(response, "audit_unavailable");
        throw auditError;
      }

      return sendJson(response, 200, { status: "ok", ...result });
    }

    if (action === "close") {
      if (!positionId || typeof positionId !== "string") throw new InputValidationError("Position ID is required");
      if (!quote || typeof quote !== "object") throw new InputValidationError("Quote is required");

      const engine = createPaperEngine(db, { userId: session.userId });
      await engine.load();
      const result = await engine.closePosition({ positionId, quote });

      try {
        await insertAuditEvent(db, {
          userId: session.userId,
          eventType: "paper.position.closed",
          metadata: { positionId, tradeId: result.tradeId, netPnl: result.netPnl, equityAfter: result.equityAfter, simulated: true }
        });
      } catch (auditError) {
        if (auditError instanceof DatabaseConfigurationError || auditError instanceof DatabaseQueryError) return unavailable(response, "audit_unavailable");
        throw auditError;
      }

      return sendJson(response, 200, { status: "ok", ...result });
    }

    throw new InputValidationError("Action must be 'open' or 'close'");
  } catch (error) {
    if (error instanceof AuthError) return sendJson(response, error.status, { status: "error", code: error.code, message: error.message });
    if (error instanceof InputValidationError) return sendJson(response, 400, { status: "error", code: "invalid_request", message: error.message });
    if (error instanceof PaperValidationError) return sendJson(response, 400, { status: "error", code: error.code, message: error.message, simulated: true, live: false });
    if (error instanceof PaperInsufficientFundsError) return sendJson(response, 403, { status: "error", code: error.code, message: error.message, simulated: true, live: false });
    if (error instanceof DatabaseConfigurationError || error instanceof DatabaseQueryError) return unavailable(response, "database_unavailable");
    throw error;
  }
}
