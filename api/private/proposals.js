import { loadConfig, ConfigurationError } from "../_lib/config.js";
import { csrfMatches, getSession } from "../_lib/auth.js";
import { DatabaseConfigurationError, DatabaseQueryError, getDatabase } from "../_lib/database.js";
import { sendJson, methodNotAllowed } from "../_lib/http.js";
import { assertSameOrigin, InputValidationError, parseJsonBody } from "../_lib/validation.js";
import { findProposal, listProposals, transitionProposal } from "../_lib/proposals/repository.js";
import { proposalEligibility, verifyProposalDigest } from "../_lib/proposals/canonical.js";

function safeUnavailable(response, code = "proposal_unavailable") { return sendJson(response, 503, { status: "unavailable", code, message: "Proposal workflow is unavailable", approvalAllowed: false }); }
function query(request) { const url = new URL(request.url || "http://localhost/api/private/proposals", "http://localhost"); return { proposalId: url.searchParams.get("proposalId") || "", version: Number(url.searchParams.get("version") || "0") }; }

function actionPayload(request) {
  const body = parseJsonBody(request, 2_048);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["action", "proposalId", "proposalVersion", "contentDigest", "reason"].includes(key))) throw new InputValidationError("Proposal action is invalid");
  if (!["approve", "reject"].includes(body.action) || typeof body.proposalId !== "string" || !/^prop_[A-Za-z0-9-]{20,80}$/.test(body.proposalId) || !Number.isSafeInteger(body.proposalVersion) || body.proposalVersion < 1 || typeof body.contentDigest !== "string" || !/^[a-f0-9]{64}$/.test(body.contentDigest)) throw new InputValidationError("Proposal action is invalid");
  if (body.action === "reject" && body.reason != null && (typeof body.reason !== "string" || body.reason.length > 500)) throw new InputValidationError("Rejection reason is invalid");
  return { action: body.action, proposalId: body.proposalId, version: body.proposalVersion, contentDigest: body.contentDigest, reason: body.reason || null };
}

function rowProposal(row) { const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload; return { ...payload, status: row.status, contentDigest: row.content_digest, persistence: { createdAt: row.created_at, updatedAt: row.updated_at } }; }

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed(response, "GET, POST");
  let config; try { config = loadConfig(); } catch (error) { if (error instanceof ConfigurationError) return safeUnavailable(response, "configuration_invalid"); throw error; }
  if (!config.auth.configured) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" });
  if (!config.database.configured) return safeUnavailable(response, "database_unavailable");
  let db; let session;
  try { db = getDatabase(); session = await getSession(request, db, config); } catch (error) { if (error instanceof DatabaseConfigurationError || error instanceof DatabaseQueryError) return safeUnavailable(response, "database_unavailable"); throw error; }
  if (!session) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" });
  try {
    if (request.method === "GET") {
      const { proposalId, version } = query(request);
      if (proposalId) { if (!/^prop_[A-Za-z0-9-]{20,80}$/.test(proposalId) || !Number.isSafeInteger(version) || version < 1) return sendJson(response, 400, { status: "error", code: "invalid_request", message: "Proposal identifier is invalid" }); const row = await findProposal(db, session.userId, proposalId, version); return row ? sendJson(response, 200, { status: "ok", proposal: rowProposal(row) }) : sendJson(response, 404, { status: "error", code: "proposal_not_found", message: "Proposal not found" }); }
      const rows = await listProposals(db, session.userId); return sendJson(response, 200, { status: "ok", proposals: rows.map(rowProposal) });
    }
    assertSameOrigin(request, config.appOrigin); if (!csrfMatches(request, session)) return sendJson(response, 401, { status: "error", code: "authentication_required", message: "Authentication required" });
    const action = actionPayload(request);
    if (action.action === "approve") {
      const row = await findProposal(db, session.userId, action.proposalId, action.version);
      if (!row) return sendJson(response, 404, { status: "error", code: "proposal_not_found", message: "Proposal not found" });
      const proposal = rowProposal(row);
      if (proposal.contentDigest !== action.contentDigest || !verifyProposalDigest(proposal)) return sendJson(response, 409, { status: "error", code: "proposal_digest_mismatch", message: "Proposal content no longer matches its immutable digest", approvalAllowed: false });
      if (proposal.status === "approved" && proposal.contentDigest === action.contentDigest) return sendJson(response, 200, { status: "ok", idempotent: true, proposal });
      if (proposal.status !== "pending_approval") return sendJson(response, 409, { status: "error", code: "proposal_not_eligible", message: "Proposal is not pending approval", approvalAllowed: false });
      const content = proposal.immutableContent; const eligibility = proposalEligibility({ candidate: { symbol: content.symbol, direction: content.direction, stopLoss: content.stopLoss, takeProfit: content.takeProfit, expiry: content.expiresAt }, riskEvaluation: { decision: content.risk?.decision }, now: new Date() });
      if (!eligibility.eligible) return sendJson(response, 409, { status: "error", code: "proposal_not_eligible", reasons: eligibility.reasons, approvalAllowed: false });
    }
    const transitioned = await transitionProposal(db, { userId: session.userId, proposalId: action.proposalId, version: action.version, contentDigest: action.contentDigest, nextStatus: action.action === "approve" ? "approved" : "rejected", actor: session.userId, reason: action.reason });
    if (!transitioned) { const current = await findProposal(db, session.userId, action.proposalId, action.version); if (current?.status === (action.action === "approve" ? "approved" : "rejected") && current.content_digest === action.contentDigest) return sendJson(response, 200, { status: "ok", idempotent: true, proposal: rowProposal(current) }); return sendJson(response, 409, { status: "error", code: "proposal_state_changed", message: "Proposal state changed or is no longer eligible", approvalAllowed: false }); }
    return sendJson(response, 200, { status: "ok", decision: action.action === "approve" ? "approved" : "rejected", proposalId: action.proposalId, proposalVersion: action.version, contentDigest: action.contentDigest, executionAllowed: false, tradingEnabled: false });
  } catch (error) {
    if (error instanceof InputValidationError) return sendJson(response, 400, { status: "error", code: "invalid_request", message: error.message });
    if (error instanceof DatabaseConfigurationError || error instanceof DatabaseQueryError) return safeUnavailable(response, "database_unavailable");
    throw error;
  }
}
