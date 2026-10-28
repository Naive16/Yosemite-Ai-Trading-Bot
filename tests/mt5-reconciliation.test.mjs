import test from "node:test";
import assert from "node:assert/strict";
import { EXECUTION_STATES, ExecutionLedger, ReconciliationError, REQUIRED_EXECUTION_GATES } from "../api/_lib/mt5/reconciliation.js";

const proposalId = "prop_11111111-1111-4111-8111-111111111111";
const digest = "a".repeat(64);
const gates = () => Object.fromEntries(REQUIRED_EXECUTION_GATES.map((key) => [key, true]));
const intent = (overrides = {}) => ({ proposalId, proposalVersion: 1, contentDigest: digest, gates: gates(), ...overrides });
const model = (options = {}) => new ExecutionLedger({ executionEnabled: true, ...options });
const errorCode = (code) => (error) => error instanceof ReconciliationError && error.code === code;
function submitted() {
  const ledger = model();
  const key = ledger.reserve(intent()).record.idempotencyKey;
  ledger.transition(key, EXECUTION_STATES.SUBMISSION_INITIATED);
  return { ledger, key };
}

test("execution model stays disabled by default and requires an explicit boolean constructor switch", () => {
  assert.throws(() => new ExecutionLedger().reserve(intent()), errorCode("execution_disabled"));
  for (const executionEnabled of ["true", 1, {}, null]) assert.throws(() => new ExecutionLedger({ executionEnabled }), errorCode("execution_configuration_invalid"));
});

test("every required named gate must be an own data property with boolean true", () => {
  const ledger = model();
  for (const invalid of [undefined, null, {}, [], { unrelated: true }, Object.create(gates()), { ...gates(), extraGate: true }]) assert.throws(() => ledger.reserve(intent({ gates: invalid })), errorCode("execution_gates_blocked"));
  for (const name of REQUIRED_EXECUTION_GATES) {
    const missing = gates(); delete missing[name];
    assert.throws(() => ledger.reserve(intent({ gates: missing })), errorCode("execution_gates_blocked"));
    for (const value of [false, "true", 1, null]) assert.throws(() => ledger.reserve(intent({ gates: { ...gates(), [name]: value } })), errorCode("execution_gates_blocked"));
  }
  const accessor = gates();
  Object.defineProperty(accessor, "actor", { get() { throw new Error("Accessor must not be evaluated"); } });
  assert.throws(() => ledger.reserve(intent({ gates: accessor })), errorCode("execution_gates_blocked"));
  assert.equal(ledger.reserve(intent()).status, "reserved");
});

test("invalid proposal identities, versions, digests and generated execution IDs cannot reserve", () => {
  for (const overrides of [{ proposalId: undefined }, { proposalId: "prop_1" }, { proposalId: proposalId + ":other" }, { proposalVersion: 0 }, { proposalVersion: "1" }, { proposalVersion: 2_147_483_648 }, { contentDigest: "" }, { contentDigest: "A".repeat(64) }, { contentDigest: "z".repeat(64) }]) assert.throws(() => model().reserve(intent(overrides)), errorCode("execution_identity_invalid"));
  for (const executionId of ["short", "x".repeat(121), "exec_" + "x".repeat(20) + ":injected", undefined]) assert.throws(() => model({ idFactory: () => executionId }).reserve(intent()), errorCode("execution_identity_invalid"));
  const ledger = model({ idFactory: () => "exec_same_identifier_for_every_intent" });
  ledger.reserve(intent());
  assert.throws(() => ledger.reserve(intent({ proposalVersion: 2 })), errorCode("execution_identity_invalid"));
});

test("duplicate reservation reuses exactly one identity and returns detached snapshots", () => {
  let generated = 0;
  const ledger = model({ idFactory: () => `exec_test_identifier_${++generated}` });
  const first = ledger.reserve(intent());
  const key = first.record.idempotencyKey;
  first.record.state = EXECUTION_STATES.FILLED;
  first.record.executionId = "forged";
  first.record.brokerDealIds.push("injected-deal");
  const duplicate = ledger.reserve(intent());
  assert.equal(duplicate.status, "duplicate");
  assert.equal(generated, 1);
  assert.equal(duplicate.record.state, EXECUTION_STATES.RESERVED);
  assert.equal(duplicate.record.executionId, "exec_test_identifier_1");
  assert.deepEqual(duplicate.record.brokerDealIds, []);
  assert.equal(duplicate.record.idempotencyKey, key);
  assert.equal(ledger.records, undefined);
});

test("transition and timeout metadata cannot overwrite identity, timestamps, or state", () => {
  const { ledger, key } = submitted();
  for (const name of ["state", "executionId", "idempotencyKey", "proposalId", "proposalVersion", "contentDigest", "createdAt", "updatedAt", "__proto__"]) {
    const metadata = { [name]: "forged" };
    assert.throws(() => ledger.transition(key, EXECUTION_STATES.ACKNOWLEDGED, metadata), errorCode("execution_metadata_invalid"));
    assert.throws(() => ledger.markSubmissionUnknown(key, metadata), errorCode("execution_metadata_invalid"));
  }
  assert.equal(ledger.markSubmissionUnknown(key).state, EXECUTION_STATES.UNKNOWN);
  assert.throws(() => ledger.transition(key, EXECUTION_STATES.FILLED, { brokerOrderId: "order-1", brokerDealIds: ["deal-1"] }), errorCode("reconciliation_required"));
});

test("repeated missing broker observations stay blocked and preserve the original identity", () => {
  const { ledger, key } = submitted();
  const original = ledger.markSubmissionUnknown(key);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const missing = ledger.reconcile(key, { status: "missing" });
    assert.equal(missing.state, EXECUTION_STATES.RECONCILIATION_REQUIRED);
    assert.equal(missing.discrepancy, "broker_record_missing");
    assert.equal(missing.executionId, original.executionId);
    assert.equal(missing.idempotencyKey, key);
  }
  assert.equal(ledger.reserve(intent()).status, "duplicate");
  assert.throws(() => ledger.transition(key, EXECUTION_STATES.SUBMISSION_INITIATED), errorCode("invalid_transition"));
});

test("broker reports must have a known shape and real identifier fields before claiming a fill", () => {
  const { ledger, key } = submitted();
  ledger.markSubmissionUnknown(key);
  for (const report of [null, [], {}, { status: "success" }, { status: "filled" }, { status: "filled", orderId: "order-1" }, { status: "filled", orderId: "order-1", dealIds: [""] }, { status: "filled", orderId: "order-1", dealIds: ["deal-1"], state: "filled" }, { status: "missing", orderId: "order-1" }]) assert.throws(() => ledger.reconcile(key, report), ReconciliationError);
  const filled = ledger.reconcile(key, { status: "filled", orderId: "order-1", dealIds: ["deal-1"] });
  assert.equal(filled.state, EXECUTION_STATES.FILLED);
  assert.equal(filled.discrepancy, null);
  assert.deepEqual(filled.brokerDealIds, ["deal-1"]);
  assert.throws(() => ledger.reconcile(key, { status: "filled", orderId: "different-order", dealIds: ["deal-2"] }), errorCode("broker_identity_conflict"));
});

test("partial-fill observations accumulate detached deal evidence without losing older deals", () => {
  const { ledger, key } = submitted();
  ledger.transition(key, EXECUTION_STATES.ACKNOWLEDGED);
  assert.throws(() => ledger.transition(key, EXECUTION_STATES.FILLED), errorCode("execution_evidence_missing"));
  const input = ["deal-1"];
  const first = ledger.reconcile(key, { status: "partial", orderId: "order-1", dealIds: input });
  input.push("caller-mutated"); first.brokerDealIds.push("snapshot-mutated");
  const second = ledger.reconcile(key, { status: "partial", orderId: "order-1", dealIds: ["deal-2"] });
  assert.deepEqual(second.brokerDealIds, ["deal-1", "deal-2"]);
  const filled = ledger.reconcile(key, { status: "filled", orderId: "order-1", dealIds: ["deal-2"] });
  assert.deepEqual(filled.brokerDealIds, ["deal-1", "deal-2"]);
  assert.equal(ledger.reconcile(key, { status: "filled", orderId: "order-1", dealIds: ["deal-2"] }).state, EXECUTION_STATES.FILLED);
});
