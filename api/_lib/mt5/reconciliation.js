import { randomUUID } from "node:crypto";

export const EXECUTION_STATES = Object.freeze({ APPROVED: "approved", RESERVED: "execution_reserved", SUBMISSION_INITIATED: "submission_initiated", ACKNOWLEDGED: "broker_acknowledged", ACCEPTED: "order_accepted", PARTIAL: "partially_filled", FILLED: "filled", CANCEL_REQUESTED: "cancel_requested", CANCELLED: "cancelled", REJECTED: "rejected", UNKNOWN: "submission_unknown", RECONCILIATION_REQUIRED: "reconciliation_required" });

// This is an isolated state-machine model, not a durable execution service.
// A future orchestrator must derive these facts from trusted server checks.
// "reserved" retains the historical contract name for reservation capability;
// it cannot prove a durable reservation has already happened in this Map.
export const REQUIRED_EXECUTION_GATES = Object.freeze(["actor", "proposal", "digest", "risk", "inputs", "demo", "mode", "stop", "reserved", "finalRisk"]);

export class ReconciliationError extends Error {
  constructor(message, code = "reconciliation_error") { super(message); this.name = "ReconciliationError"; this.code = code; }
}

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

function dataProperties(value, allowed, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new ReconciliationError("Execution input is invalid", code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !allowed.includes(key) || !Object.hasOwn(descriptors[key], "value"))) throw new ReconciliationError("Execution input contains unsupported fields", code);
  return descriptors;
}

function validateGates(gates) {
  const descriptors = dataProperties(gates, REQUIRED_EXECUTION_GATES, "execution_gates_blocked");
  if (REQUIRED_EXECUTION_GATES.some((key) => descriptors[key]?.value !== true)) throw new ReconciliationError("Execution gates are not all satisfied", "execution_gates_blocked");
}

function brokerId(value) { return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value); }
function snapshot(record) { return { ...record, brokerDealIds: [...record.brokerDealIds] }; }

function metadataUpdates(record, metadata) {
  dataProperties(metadata, ["brokerOrderId", "brokerDealIds", "discrepancy"], "execution_metadata_invalid");
  const updates = {};
  if (Object.hasOwn(metadata, "brokerOrderId")) {
    if (!brokerId(metadata.brokerOrderId)) throw new ReconciliationError("Broker order identifier is invalid", "execution_metadata_invalid");
    if (record.brokerOrderId && metadata.brokerOrderId !== record.brokerOrderId) throw new ReconciliationError("Broker order identity cannot change", "broker_identity_conflict");
    updates.brokerOrderId = metadata.brokerOrderId;
  }
  if (Object.hasOwn(metadata, "brokerDealIds")) {
    if (!Array.isArray(metadata.brokerDealIds) || metadata.brokerDealIds.length > 512 || metadata.brokerDealIds.some((id) => !brokerId(id))) throw new ReconciliationError("Broker deal identifiers are invalid", "execution_metadata_invalid");
    updates.brokerDealIds = [...new Set([...record.brokerDealIds, ...metadata.brokerDealIds])];
    if (updates.brokerDealIds.length > 512) throw new ReconciliationError("Broker deal identifiers exceed the model limit", "execution_metadata_invalid");
  }
  if (Object.hasOwn(metadata, "discrepancy")) {
    if (metadata.discrepancy !== null && (typeof metadata.discrepancy !== "string" || !/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(metadata.discrepancy))) throw new ReconciliationError("Execution discrepancy code is invalid", "execution_metadata_invalid");
    updates.discrepancy = metadata.discrepancy;
  }
  return updates;
}

function requireBrokerEvidence(record, updates, nextState) {
  const orderId = updates.brokerOrderId || record.brokerOrderId;
  const deals = updates.brokerDealIds || record.brokerDealIds;
  if ([EXECUTION_STATES.ACCEPTED, EXECUTION_STATES.CANCEL_REQUESTED, EXECUTION_STATES.CANCELLED, EXECUTION_STATES.PARTIAL, EXECUTION_STATES.FILLED].includes(nextState) && !orderId) throw new ReconciliationError("Broker order evidence is required for this state", "execution_evidence_missing");
  if ([EXECUTION_STATES.PARTIAL, EXECUTION_STATES.FILLED].includes(nextState) && !deals.length) throw new ReconciliationError("Broker deal evidence is required for a fill state", "execution_evidence_missing");
}

export class ExecutionLedger {
  #records = new Map();
  #executionEnabled;
  #now;
  #idFactory;

  constructor({ executionEnabled = false, now = () => new Date(), idFactory = () => `exec_${randomUUID()}` } = {}) {
    if (typeof executionEnabled !== "boolean" || typeof now !== "function" || typeof idFactory !== "function") throw new ReconciliationError("Execution model configuration is invalid", "execution_configuration_invalid");
    this.#executionEnabled = executionEnabled; this.#now = now; this.#idFactory = idFactory;
  }
  get executionEnabled() { return this.#executionEnabled; }
  #timestamp() {
    const date = new Date(this.#now());
    if (!Number.isFinite(date.getTime())) throw new ReconciliationError("Execution timestamp is invalid", "execution_timestamp_invalid");
    return date.toISOString();
  }
  #record(idempotencyKey) {
    const record = this.#records.get(idempotencyKey);
    if (!record) throw new ReconciliationError("Execution intent is not found", "execution_not_found");
    return record;
  }
  reserve({ proposalId, proposalVersion, contentDigest, gates } = {}) {
    if (!this.#executionEnabled) throw new ReconciliationError("Execution is disabled", "execution_disabled");
    if (typeof proposalId !== "string" || !/^prop_[A-Za-z0-9-]{20,80}$/.test(proposalId) || !Number.isSafeInteger(proposalVersion) || proposalVersion < 1 || proposalVersion > 2_147_483_647 || typeof contentDigest !== "string" || !/^[a-f0-9]{64}$/.test(contentDigest)) throw new ReconciliationError("Execution proposal identity is invalid", "execution_identity_invalid");
    validateGates(gates);
    const key = `${proposalId}:${proposalVersion}:${contentDigest}`;
    const existing = this.#records.get(key);
    if (existing) return { status: "duplicate", record: snapshot(existing) };
    const executionId = this.#idFactory();
    if (typeof executionId !== "string" || !/^[A-Za-z0-9_-]{20,120}$/.test(executionId) || [...this.#records.values()].some((record) => record.executionId === executionId)) throw new ReconciliationError("Execution identifier is invalid or already assigned", "execution_identity_invalid");
    const at = this.#timestamp();
    const record = { executionId, idempotencyKey: key, proposalId, proposalVersion, contentDigest, state: EXECUTION_STATES.RESERVED, createdAt: at, updatedAt: at, brokerOrderId: null, brokerDealIds: [], discrepancy: null };
    this.#records.set(key, record);
    return { status: "reserved", record: snapshot(record) };
  }
  transition(idempotencyKey, nextState, metadata = {}) {
    const record = this.#record(idempotencyKey);
    if (record.state === EXECUTION_STATES.UNKNOWN && nextState !== EXECUTION_STATES.RECONCILIATION_REQUIRED) throw new ReconciliationError("Unknown outcome requires reconciliation", "reconciliation_required");
    if (!transitions.get(record.state)?.has(nextState)) throw new ReconciliationError("Execution state transition is not allowed", "invalid_transition");
    const updates = metadataUpdates(record, metadata);
    requireBrokerEvidence(record, updates, nextState);
    Object.assign(record, updates, { state: nextState, updatedAt: this.#timestamp() });
    return snapshot(record);
  }
  markSubmissionUnknown(idempotencyKey, metadata = {}) {
    const record = this.#record(idempotencyKey);
    if (![EXECUTION_STATES.SUBMISSION_INITIATED, EXECUTION_STATES.CANCEL_REQUESTED].includes(record.state)) throw new ReconciliationError("Only an in-flight submission can become unknown", "invalid_transition");
    return this.transition(idempotencyKey, EXECUTION_STATES.UNKNOWN, { discrepancy: "submission_outcome_unknown", ...metadataUpdates(record, metadata) });
  }
  reconcile(idempotencyKey, providerState) {
    const record = this.#record(idempotencyKey);
    dataProperties(providerState, ["status", "orderId", "dealIds"], "provider_state_invalid");
    if (!["accepted", "partial", "filled", "cancelled", "rejected", "missing"].includes(providerState.status)) throw new ReconciliationError("Provider reconciliation state is invalid", "provider_state_invalid");
    if (providerState.status === "missing" && (Object.hasOwn(providerState, "orderId") || Object.hasOwn(providerState, "dealIds"))) throw new ReconciliationError("Missing provider state cannot claim broker identifiers", "provider_state_invalid");
    const metadata = { discrepancy: providerState.status === "missing" ? "broker_record_missing" : null };
    if (Object.hasOwn(providerState, "orderId")) metadata.brokerOrderId = providerState.orderId;
    if (Object.hasOwn(providerState, "dealIds")) metadata.brokerDealIds = providerState.dealIds;
    const updates = metadataUpdates(record, metadata);
    const orderId = updates.brokerOrderId || record.brokerOrderId;
    const dealIds = updates.brokerDealIds || record.brokerDealIds;
    if (["accepted", "partial", "filled", "cancelled"].includes(providerState.status) && !orderId) throw new ReconciliationError("Provider reconciliation requires a broker order identifier", "provider_state_invalid");
    if (["partial", "filled"].includes(providerState.status) && !dealIds.length) throw new ReconciliationError("A fill requires broker deal identifiers", "provider_state_invalid");
    if (record.state === EXECUTION_STATES.UNKNOWN) this.transition(idempotencyKey, EXECUTION_STATES.RECONCILIATION_REQUIRED, { discrepancy: "submission_outcome_unknown" });
    if (providerState.status === "missing") {
      if (record.state === EXECUTION_STATES.RECONCILIATION_REQUIRED) {
        if (record.discrepancy !== "broker_record_missing") Object.assign(record, updates, { updatedAt: this.#timestamp() });
        return snapshot(record);
      }
      return this.transition(idempotencyKey, EXECUTION_STATES.RECONCILIATION_REQUIRED, updates);
    }
    const nextState = { accepted: EXECUTION_STATES.ACCEPTED, partial: EXECUTION_STATES.PARTIAL, filled: EXECUTION_STATES.FILLED, cancelled: EXECUTION_STATES.CANCELLED, rejected: EXECUTION_STATES.REJECTED }[providerState.status];
    if (record.state === nextState) {
      if ((updates.brokerOrderId && updates.brokerOrderId !== record.brokerOrderId) || (updates.brokerDealIds && updates.brokerDealIds.length !== record.brokerDealIds.length) || record.discrepancy !== updates.discrepancy) Object.assign(record, updates, { updatedAt: this.#timestamp() });
      return snapshot(record);
    }
    return this.transition(idempotencyKey, nextState, updates);
  }
}
