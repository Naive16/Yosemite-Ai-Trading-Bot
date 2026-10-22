import { randomUUID } from "node:crypto";

export const EXECUTION_STATES = Object.freeze({ APPROVED: "approved", RESERVED: "execution_reserved", SUBMISSION_INITIATED: "submission_initiated", ACKNOWLEDGED: "broker_acknowledged", ACCEPTED: "order_accepted", PARTIAL: "partially_filled", FILLED: "filled", CANCEL_REQUESTED: "cancel_requested", CANCELLED: "cancelled", REJECTED: "rejected", UNKNOWN: "submission_unknown", RECONCILIATION_REQUIRED: "reconciliation_required" });

export class ReconciliationError extends Error { constructor(message, code = "reconciliation_error") { super(message); this.name = "ReconciliationError"; this.code = code; } }

const transitions = new Map([
  [EXECUTION_STATES.APPROVED, new Set([EXECUTION_STATES.RESERVED])],
  [EXECUTION_STATES.RESERVED, new Set([EXECUTION_STATES.SUBMISSION_INITIATED])],
  [EXECUTION_STATES.SUBMISSION_INITIATED, new Set([EXECUTION_STATES.ACKNOWLEDGED, EXECUTION_STATES.UNKNOWN, EXECUTION_STATES.REJECTED])],
  [EXECUTION_STATES.ACKNOWLEDGED, new Set([EXECUTION_STATES.ACCEPTED, EXECUTION_STATES.PARTIAL, EXECUTION_STATES.FILLED, EXECUTION_STATES.REJECTED])],
  [EXECUTION_STATES.ACCEPTED, new Set([EXECUTION_STATES.PARTIAL, EXECUTION_STATES.FILLED, EXECUTION_STATES.CANCEL_REQUESTED, EXECUTION_STATES.RECONCILIATION_REQUIRED])],
  [EXECUTION_STATES.PARTIAL, new Set([EXECUTION_STATES.PARTIAL, EXECUTION_STATES.FILLED, EXECUTION_STATES.CANCEL_REQUESTED, EXECUTION_STATES.RECONCILIATION_REQUIRED])],
  [EXECUTION_STATES.CANCEL_REQUESTED, new Set([EXECUTION_STATES.CANCELLED, EXECUTION_STATES.UNKNOWN, EXECUTION_STATES.RECONCILIATION_REQUIRED])],
  [EXECUTION_STATES.UNKNOWN, new Set([EXECUTION_STATES.RECONCILIATION_REQUIRED])],
  [EXECUTION_STATES.RECONCILIATION_REQUIRED, new Set([EXECUTION_STATES.ACCEPTED, EXECUTION_STATES.PARTIAL, EXECUTION_STATES.FILLED, EXECUTION_STATES.CANCELLED, EXECUTION_STATES.REJECTED, EXECUTION_STATES.UNKNOWN])]
]);

export class ExecutionLedger {
  constructor({ executionEnabled = false, now = () => new Date(), idFactory = () => `exec_${randomUUID()}` } = {}) { this.executionEnabled = executionEnabled; this.now = now; this.idFactory = idFactory; this.records = new Map(); }
  reserve({ proposalId, proposalVersion, contentDigest, gates } = {}) {
    if (!this.executionEnabled) throw new ReconciliationError("Execution is disabled", "execution_disabled");
    if (!gates || Object.values(gates).some((value) => value !== true)) throw new ReconciliationError("Execution gates are not all satisfied", "execution_gates_blocked");
    const key = `${proposalId}:${proposalVersion}:${contentDigest}`;
    const existing = this.records.get(key); if (existing) return { status: "duplicate", record: { ...existing } };
    const record = { executionId: this.idFactory(), idempotencyKey: key, proposalId, proposalVersion, contentDigest, state: EXECUTION_STATES.RESERVED, createdAt: this.now().toISOString(), updatedAt: this.now().toISOString(), brokerOrderId: null, brokerDealIds: [] };
    this.records.set(key, record); return { status: "reserved", record: { ...record } };
  }
  transition(idempotencyKey, nextState, metadata = {}) { const record = [...this.records.values()].find((item) => item.idempotencyKey === idempotencyKey); if (!record) throw new ReconciliationError("Execution intent is not found", "execution_not_found"); if (!transitions.get(record.state)?.has(nextState)) throw new ReconciliationError("Execution state transition is not allowed", "invalid_transition"); if (record.state === EXECUTION_STATES.UNKNOWN && nextState !== EXECUTION_STATES.RECONCILIATION_REQUIRED) throw new ReconciliationError("Unknown outcome requires reconciliation", "reconciliation_required"); Object.assign(record, metadata, { state: nextState, updatedAt: this.now().toISOString() }); return { ...record }; }
  markSubmissionUnknown(idempotencyKey, metadata = {}) { const record = [...this.records.values()].find((item) => item.idempotencyKey === idempotencyKey); if (!record) throw new ReconciliationError("Execution intent is not found", "execution_not_found"); if (![EXECUTION_STATES.SUBMISSION_INITIATED, EXECUTION_STATES.CANCEL_REQUESTED].includes(record.state)) throw new ReconciliationError("Only an in-flight submission can become unknown", "invalid_transition"); record.state = EXECUTION_STATES.UNKNOWN; record.updatedAt = this.now().toISOString(); Object.assign(record, metadata); return { ...record }; }
  reconcile(idempotencyKey, providerState) { const record = [...this.records.values()].find((item) => item.idempotencyKey === idempotencyKey); if (!record) throw new ReconciliationError("Execution intent is not found", "execution_not_found"); if (!providerState || typeof providerState !== "object" || !["accepted", "partial", "filled", "cancelled", "rejected", "missing"].includes(providerState.status)) throw new ReconciliationError("Provider reconciliation state is invalid", "provider_state_invalid"); if (record.state === EXECUTION_STATES.UNKNOWN) this.transition(idempotencyKey, EXECUTION_STATES.RECONCILIATION_REQUIRED, { discrepancy: "submission_outcome_unknown" }); if (providerState.status === "missing") return this.transition(idempotencyKey, EXECUTION_STATES.RECONCILIATION_REQUIRED, { discrepancy: "broker_record_missing" }); const next = { accepted: EXECUTION_STATES.ACCEPTED, partial: EXECUTION_STATES.PARTIAL, filled: EXECUTION_STATES.FILLED, cancelled: EXECUTION_STATES.CANCELLED, rejected: EXECUTION_STATES.REJECTED }[providerState.status]; return this.transition(idempotencyKey, next, { brokerOrderId: providerState.orderId || record.brokerOrderId, brokerDealIds: Array.isArray(providerState.dealIds) ? [...providerState.dealIds] : record.brokerDealIds }); }
}
