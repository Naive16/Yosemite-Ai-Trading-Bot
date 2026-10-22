import test from "node:test";
import assert from "node:assert/strict";
import { createProposal, proposalDigest, proposalEligibility, verifyProposalDigest } from "../api/_lib/proposals/canonical.js";
import { transitionProposal } from "../api/_lib/proposals/repository.js";

const candidate = { symbol: "EUR/USD", direction: "BUY", timeframe: "M15", entryConditions: [{ type: "confirmation_required" }], referencePrice: { value: 1.1, timestamp: "2026-10-21T11:59:00Z" }, stopLoss: { value: 1.095 }, takeProfit: { value: 1.11 }, rewardRisk: 2, reasons: [{ code: "trend_confirmed", message: "MA aligned" }], strategy: { name: "baseline", version: "1.0.0" }, expiry: "2026-10-21T12:15:00Z" };
const risk = { decision: "PASS", reasonCodes: [], engine: { version: "risk-baseline-v1" }, positionSizing: { volume: 0.04, estimatedLossAtStop: 25 } };

test("proposal canonical digest is stable and material changes are detectable", () => {
  const proposal = createProposal({ candidate, riskEvaluation: risk, accountMetadata: { currency: "USD", capturedAt: "2026-10-21T11:59:30Z" }, marketData: { source: "fixture", freshness: "fresh" }, now: new Date("2026-10-21T12:00:00Z") });
  assert.equal(proposal.status, "pending_approval"); assert.equal(proposal.eligibility.eligible, true); assert.equal(verifyProposalDigest(proposal), true);
  const changed = { ...proposal.immutableContent, stopLoss: { value: 1.09 } }; assert.notEqual(proposal.contentDigest, proposalDigest(changed));
  assert.equal(proposal.immutableContent.accountMetadata.currency, "USD");
});

test("REJECT, BLOCKED, expired, and malformed candidates are never eligible", () => {
  assert.equal(proposalEligibility({ candidate, riskEvaluation: { decision: "REJECT" }, now: new Date("2026-10-21T12:00:00Z") }).eligible, false);
  assert.equal(proposalEligibility({ candidate, riskEvaluation: { decision: "BLOCKED" }, now: new Date("2026-10-21T12:00:00Z") }).eligible, false);
  assert.equal(proposalEligibility({ candidate: { ...candidate, expiry: "2026-10-21T11:00:00Z" }, riskEvaluation: risk, now: new Date("2026-10-21T12:00:00Z") }).reasons.includes("candidate_expired"), true);
  const blocked = createProposal({ candidate, riskEvaluation: { decision: "BLOCKED", reasonCodes: ["account_unavailable"], engine: { version: "risk-baseline-v1" } }, now: new Date("2026-10-21T12:00:00Z") }); assert.equal(blocked.status, "blocked");
});

test("proposal transition uses conditional digest and pending-state SQL", async () => {
  let call;
  const db = { async query(text, values) { call = { text, values }; return { rows: [{ proposal_id: "prop", proposal_version: 1, decision: "approved" }] }; } };
  const result = await transitionProposal(db, { userId: "user", proposalId: "prop", version: 1, contentDigest: "a".repeat(64), nextStatus: "approved", actor: "user" });
  assert.equal(result.decision, "approved"); assert.match(call.text, /status = 'pending_approval'/); assert.match(call.text, /content_digest = \$5/); assert.equal(call.values[4], "a".repeat(64));
});
