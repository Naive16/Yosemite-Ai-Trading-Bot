import { createHash, randomUUID } from "node:crypto";

export const PROPOSAL_VERSION = 1;
export const PROPOSAL_STATUSES = Object.freeze(["pending_approval", "blocked", "approved", "rejected", "expired", "invalidated", "superseded"]);

export class ProposalInputError extends Error { constructor(message, code = "invalid_proposal") { super(message); this.name = "ProposalInputError"; this.code = code; } }

function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  throw new ProposalInputError("Proposal contains an unsupported value");
}

export function canonicalizeProposal(value) { return canonical(value); }
export function proposalDigest(payload) { return createHash("sha256").update(canonicalizeProposal(payload)).digest("hex"); }
export function verifyProposalDigest(proposal) { return typeof proposal?.contentDigest === "string" && proposal.contentDigest === proposalDigest(proposal.immutableContent); }

export function proposalEligibility({ candidate, riskEvaluation, now = new Date() }) {
  const reasons = [];
  if (!candidate) reasons.push("candidate_unavailable");
  if (riskEvaluation?.decision !== "PASS") reasons.push(`risk_${String(riskEvaluation?.decision || "unavailable").toLowerCase()}`);
  if (candidate?.expiry && new Date(candidate.expiry).getTime() <= new Date(now).getTime()) reasons.push("candidate_expired");
  if (candidate && (!candidate.stopLoss?.value || !candidate.takeProfit?.value || !["BUY", "SELL"].includes(candidate.direction))) reasons.push("trade_parameters_invalid");
  return { eligible: reasons.length === 0, reasons };
}

export function createProposal({ candidate, claudeAnalysis = null, riskEvaluation, accountMetadata = null, marketData = null, now = new Date() }) {
  const createdAt = new Date(now); if (Number.isNaN(createdAt.getTime())) throw new ProposalInputError("Proposal timestamp is invalid");
  if (!candidate || typeof candidate !== "object") throw new ProposalInputError("A strategy candidate is required", "candidate_unavailable");
  const immutableContent = { symbol: candidate.symbol, direction: candidate.direction, timeframe: candidate.timeframe, entryConditions: candidate.entryConditions || [], proposedEntry: candidate.referencePrice || null, stopLoss: candidate.stopLoss || null, takeProfit: candidate.takeProfit || null, plannedPositionSize: riskEvaluation?.positionSizing || null, accountMetadata, estimatedRisk: riskEvaluation?.positionSizing?.estimatedLossAtStop ?? null, rewardRisk: candidate.rewardRisk ?? null, strategy: candidate.strategy || null, strategyEvidence: candidate.reasons || [], claudeReference: claudeAnalysis ? { analysisTimestamp: claudeAnalysis.analysisTimestamp, model: claudeAnalysis.model?.id || null, recommendation: claudeAnalysis.recommendation } : null, risk: { decision: riskEvaluation?.decision || "BLOCKED", reasonCodes: riskEvaluation?.reasonCodes || [], configurationVersion: riskEvaluation?.engine?.version || null }, marketData, expiresAt: candidate.expiry || null };
  const eligibility = proposalEligibility({ candidate, riskEvaluation, now: createdAt });
  const proposal = { proposalId: `prop_${randomUUID()}`, proposalVersion: PROPOSAL_VERSION, createdAt: createdAt.toISOString(), status: eligibility.eligible ? "pending_approval" : "blocked", eligibility, contentDigest: proposalDigest(immutableContent), immutableContent, audit: { createdBy: "server", approval: null, rejection: null, invalidation: null } };
  return Object.freeze(proposal);
}
