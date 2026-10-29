import { createHash } from "node:crypto";
import { loadConfig, ConfigurationError } from "../_lib/config.js";
import { AuthError, getSession } from "../_lib/auth.js";
import { DatabaseConfigurationError, DatabaseQueryError, getDatabase } from "../_lib/database.js";
import { insertAuditEvent } from "../_lib/repository.js";
import { sendJson, methodNotAllowed } from "../_lib/http.js";
import { assertSameOrigin, InputValidationError, parseJsonBody } from "../_lib/validation.js";
import { checkRiskRateLimit } from "../_lib/risk/rate-limit.js";
import { RateLimitUnavailableError } from "../_lib/rate-limit.js";
import { Mt5BridgeTransport, Mt5BridgeTransportError, Mt5BridgeAccountError, Mt5BridgeExecutionError } from "../_lib/mt5/bridge-transport.js";
import { runtimeEnv } from "../_lib/runtime.js";

function unavailable(response, code = "mt5_demo_unavailable", message = "MT5 demo trading is unavailable") {
  return sendJson(response, 503, { status: "unavailable", mode: "mt5_demo", code, message, demo: true, live: false, executionAllowed: false, tradingEnabled: false });
}

function bridgeUnavailable(response, connector) {
  return sendJson(response, 503, {
    status: "unavailable",
    mode: "mt5_demo",
    code: "mt5_bridge_not_configured",
    message: "MT5 demo bridge transport is not configured; no demo order can be submitted",
    demo: true,
    live: false,
    connector,
    bridgeConfigured: false,
    executionAllowed: false,
    tradingEnabled: false,
    bridgeRequired: true,
    bridgeNote: "Set MT5_CONNECTOR=mt5_bridge and MT5_BRIDGE_BASE_URL to an approved bridge endpoint, then verify against a real demo terminal. Simulated orders are not accepted.",
  });
}

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed(response, "GET, POST");
  let config;
  try { config = loadConfig(runtimeEnv(request)); } catch (error) {
    if (error instanceof ConfigurationError) return unavailable(response, "configuration_invalid", "MT5 demo trading is unavailable");
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
  if (!config.mt5.demoMode) return unavailable(response, "demo_mode_disabled", "MT5 demo mode is not enabled");

  let limit;
  try { limit = await checkRiskRateLimit(db, request, config, session.userId); } catch (error) {
    if (error instanceof AuthError) return sendJson(response, error.status, { status: "error", code: error.code, message: error.message });
    if (error instanceof RateLimitUnavailableError) return unavailable(response, "rate_limiter_unavailable");
    throw error;
  }
  if (!limit.allowed) return sendJson(response, 429, { status: "error", code: "rate_limited", message: "MT5 demo rate limit reached" }, { "Retry-After": String(limit.retryAfterSeconds) });

  if (request.method === "GET") {
    // Return MT5 demo account status. With the default connector "none" no
    // bridge is available; this is reported explicitly and is not simulated.
    const bridgeConfigured = config.mt5.connector === "mt5_bridge" && Boolean(config.mt5.bridgeBaseUrl);
    return sendJson(response, 200, {
      status: bridgeConfigured ? "ok" : "unavailable",
      mode: "mt5_demo",
      demo: true,
      live: false,
      connected: bridgeConfigured,
      executionAllowed: false,
      tradingEnabled: false,
      connector: config.mt5.connector,
      bridgeConfigured,
      bridgeRequired: true,
      allowlist: {
        accounts: config.mt5.allowedAccountLogins,
        servers: config.mt5.allowedServers
      },
      bridgeNote: bridgeConfigured
        ? "Bridge transport is configured. Demo order submission forwards to the bridge; live execution remains disabled."
        : "No MT5 bridge transport is configured. Demo order submission is unavailable, not simulated. Connect an approved Windows VPS MT5 demo terminal bridge for actual terminal execution."
    });
  }

  // POST - submit a demo order via the MT5 bridge only. No simulation fallback.
  if (config.mt5.connector !== "mt5_bridge" || !config.mt5.bridgeBaseUrl) {
    return bridgeUnavailable(response, config.mt5.connector);
  }

  try {
    assertSameOrigin(request, config.appOrigin);
    const body = parseJsonBody(request, 2_048);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new InputValidationError("Request body must be an object");

    const { action, symbol, volume, type, stopLoss, takeProfit, comment, proposal } = body;

    if (action !== "submit_order") throw new InputValidationError("Action must be 'submit_order'");
    if (!symbol || typeof symbol !== "string") throw new InputValidationError("Symbol is required");
    if (!volume || typeof volume !== "number" || volume <= 0) throw new InputValidationError("Volume is required");
    if (!type || !["BUY", "SELL"].includes(type)) throw new InputValidationError("Order type must be BUY or SELL");

    // Require an approved proposal for demo execution.
    if (!proposal || typeof proposal !== "object") throw new InputValidationError("Proposal is required for demo execution");
    if (proposal.status !== "approved") throw new InputValidationError("Proposal must be approved before demo execution");
    if (proposal.immutableContent?.risk?.decision !== "PASS") throw new InputValidationError("Proposal risk decision must be PASS");

    const transport = new Mt5BridgeTransport({
      baseUrl: config.mt5.bridgeBaseUrl,
      allowedAccountLogins: config.mt5.allowedAccountLogins,
      allowedServers: config.mt5.allowedServers,
    });

    let account;
    try { account = await transport.connect(); } catch (error) {
      if (error instanceof Mt5BridgeAccountError) return sendJson(response, 403, { status: "error", code: error.code, message: error.message, demo: true, live: false });
      if (error instanceof Mt5BridgeExecutionError) return unavailable(response, "provider_unavailable", error.message);
      throw error;
    }

    let orderResult;
    try {
      orderResult = await transport.submitOrder({
        symbol,
        volume,
        type,
        stopLoss: stopLoss != null ? Number(stopLoss) : null,
        takeProfit: takeProfit != null ? Number(takeProfit) : null,
        comment: comment || ""
      });
    } catch (error) {
      if (error instanceof Mt5BridgeAccountError) return sendJson(response, 400, { status: "error", code: error.code, message: error.message, demo: true, live: false });
      if (error instanceof Mt5BridgeExecutionError) return unavailable(response, "order_rejected", error.message);
      throw error;
    } finally {
      try { await transport.shutdown(); } catch { /* best-effort */ }
    }

    // Persist the order intent to execution_intents if the table exists.
    try {
      const idempotencyKey = `demo_${createHash("sha256").update(`${session.userId}:${symbol}:${volume}:${type}:${Date.now()}`).digest("hex").slice(0, 24)}`;
      await db.execute(
        db.client.from("execution_intents").insert({
          id: orderResult.orderId,
          user_id: session.userId,
          proposal_id: proposal.proposalId,
          proposal_version: proposal.proposalVersion,
          content_digest: proposal.contentDigest,
          idempotency_key: idempotencyKey,
          state: "broker_acknowledged",
          broker_order_id: orderResult.dealId || null,
          broker_deal_ids: orderResult.dealId ? [orderResult.dealId] : [],
          discrepancy: null
        })
      );
    } catch (dbError) {
      if (!(dbError instanceof DatabaseQueryError)) throw dbError;
      // Table may not exist if migration 005 is not applied; continue without persisting
    }

    try {
      await insertAuditEvent(db, {
        userId: session.userId,
        eventType: "mt5.demo.order.submitted",
        metadata: {
          orderId: orderResult.orderId,
          symbol: orderResult.symbol,
          type: orderResult.type,
          volume: orderResult.volume,
          accountLogin: orderResult.accountLogin,
          server: orderResult.server,
          simulated: orderResult.simulated,
          submittedToBroker: orderResult.submittedToBroker,
          connector: config.mt5.connector
        }
      });
    } catch (auditError) {
      if (auditError instanceof DatabaseConfigurationError || auditError instanceof DatabaseQueryError) return unavailable(response, "audit_unavailable");
      throw auditError;
    }

    return sendJson(response, 200, {
      status: "ok",
      mode: "mt5_demo",
      demo: true,
      live: false,
      connector: config.mt5.connector,
      bridgeSubmitted: true,
      ...orderResult,
      bridgeRequired: false,
      bridgeNote: "Demo order submitted via the MT5 bridge to a verified demo account; real-money execution is not supported."
    });
  } catch (error) {
    if (error instanceof AuthError) return sendJson(response, error.status, { status: "error", code: error.code, message: error.message });
    if (error instanceof InputValidationError) return sendJson(response, 400, { status: "error", code: "invalid_request", message: error.message });
    if (error instanceof Mt5BridgeTransportError) return sendJson(response, 503, { status: "error", code: error.code, message: error.message, demo: true, live: false });
    if (error instanceof Mt5BridgeAccountError) return sendJson(response, 400, { status: "error", code: error.code, message: error.message, demo: true, live: false });
    if (error instanceof Mt5BridgeExecutionError) return unavailable(response, "order_rejected", error.message);
    if (error instanceof DatabaseConfigurationError || error instanceof DatabaseQueryError) return unavailable(response, "database_unavailable");
    throw error;
  }
}
