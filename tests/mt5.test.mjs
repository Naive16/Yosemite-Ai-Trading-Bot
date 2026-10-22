import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, ConfigurationError } from "../api/_lib/config.js";
import { Mt5Adapter, Mt5ExecutionBlockedError, Mt5ValidationError, assertAllowedDemoAccount, classifyMt5Account, normalizeMt5Quote, normalizeMt5Symbol } from "../api/_lib/mt5/adapter.js";
import { EXECUTION_STATES, ExecutionLedger, ReconciliationError } from "../api/_lib/mt5/reconciliation.js";
import { MirroMt5Transport } from "../api/_lib/mt5/mirro.js";

const baseEnv = { APP_ENV: "test", APP_ORIGIN: "http://localhost:3000", AUTH_USERNAME: "operator", AUTH_PASSWORD_HASH: "scrypt$1024$1$1$hash$hash", SESSION_SECRET: "m".repeat(32), DATABASE_URL: "postgresql://test:test@example.test/test" };
const demoConfig = { demoMode: true, executionEnabled: false, allowedAccountLogins: ["12345"], allowedServers: ["Broker-Demo"] };
const account = { login: 12345, trade_mode: 0, server: "Broker-Demo", company: "Broker", currency: "USD", equity: 10_000, capturedAt: "2026-10-22T00:00:00Z" };

test("MT5 configuration is disabled by default and fail-closed demo mode requires allowlists", () => {
  assert.equal(loadConfig(baseEnv).mt5.executionEnabled, false);
  assert.throws(() => loadConfig({ ...baseEnv, MT5_EXECUTION_ENABLED: "true" }), ConfigurationError);
  assert.throws(() => loadConfig({ ...baseEnv, MT5_DEMO_MODE: "true" }), ConfigurationError);
  const config = loadConfig({ ...baseEnv, MT5_DEMO_MODE: "true", MT5_ALLOWED_ACCOUNT_LOGINS: "12345", MT5_ALLOWED_SERVERS: "Broker-Demo" });
  assert.deepEqual(config.mt5.allowedAccountLogins, ["12345"]);
});

test("MT5 account classification rejects unknown or live accounts and accepts only allowlisted demo identity", () => {
  const normalized = classifyMt5Account(account);
  assert.equal(normalized.classification, "demo");
  assert.equal(assertAllowedDemoAccount(normalized, demoConfig), true);
  assert.throws(() => classifyMt5Account({ ...account, trade_mode: 99 }), /unknown/);
  assert.throws(() => assertAllowedDemoAccount(classifyMt5Account({ ...account, trade_mode: 2 }), demoConfig), /demo account/);
  assert.throws(() => assertAllowedDemoAccount({ ...normalized, login: 999 }, demoConfig), /allowlisted/);
});

test("MT5 responses require complete symbol metadata and fresh matching quotes", () => {
  const symbol = normalizeMt5Symbol({ symbol: "EURUSD", visible: true, tradeMode: "full", contractSize: 100_000, volumeMin: 0.01, volumeMax: 5, volumeStep: 0.01, point: 0.00001, tickSize: 0.00001, tickValue: 1, fillingModes: ["return"] });
  assert.equal(symbol.symbol, "EURUSD");
  assert.throws(() => normalizeMt5Symbol({ symbol: "EURUSD", visible: true, tradeMode: "full", contractSize: 100_000 }), Mt5ValidationError);
  const quote = normalizeMt5Quote({ symbol: "EURUSD", bid: 1.1, ask: 1.1002, timestamp: "2026-10-22T00:00:00Z" }, { now: new Date("2026-10-22T00:00:30Z") });
  assert.equal(quote.freshness.status, "fresh");
  assert.throws(() => normalizeMt5Quote({ symbol: "EURUSD", bid: 1.1, ask: 1.1002, timestamp: "2026-10-21T00:00:00Z" }, { now: new Date("2026-10-22T00:00:00Z") }), /stale/);
});

test("MT5 adapter isolates transport and blocks order submission", async () => {
  const adapter = new Mt5Adapter({ config: demoConfig, transport: { getAccountInfo: async () => account, getSymbolInfo: async () => ({ symbol: "EURUSD", visible: true, tradeMode: "full", contractSize: 100_000, volumeMin: 0.01, volumeMax: 5, volumeStep: 0.01, point: 0.00001, tickSize: 0.00001, tickValue: 1, fillingModes: ["return"] }), getQuote: async () => ({ symbol: "EURUSD", bid: 1.1, ask: 1.1002, timestamp: "2026-10-22T00:00:00Z" }) }, now: () => new Date("2026-10-22T00:00:30Z") });
  const connected = await adapter.connect();
  assert.equal(connected.demo, true);
  assert.equal(connected.executionAllowed, false);
  await assert.rejects(() => adapter.submitOrder({}), Mt5ExecutionBlockedError);
  await adapter.shutdown();
});

test("execution ledger is disabled by default, idempotent, and requires reconciliation after unknown outcomes", () => {
  const blocked = new ExecutionLedger({ idFactory: () => "exec_test_1234567890" });
  assert.throws(() => blocked.reserve({ proposalId: "prop_1", proposalVersion: 1, contentDigest: "a".repeat(64), gates: {} }), /disabled/);
  const ledger = new ExecutionLedger({ executionEnabled: true, idFactory: () => "exec_test_1234567890" });
  const gates = Object.fromEntries(["actor", "proposal", "digest", "risk", "inputs", "demo", "mode", "stop", "reserved", "finalRisk"].map((key) => [key, true]));
  const first = ledger.reserve({ proposalId: "prop_1", proposalVersion: 1, contentDigest: "a".repeat(64), gates });
  assert.equal(first.status, "reserved");
  assert.equal(ledger.reserve({ proposalId: "prop_1", proposalVersion: 1, contentDigest: "a".repeat(64), gates }).status, "duplicate");
  ledger.transition(first.record.idempotencyKey, EXECUTION_STATES.SUBMISSION_INITIATED);
  ledger.markSubmissionUnknown(first.record.idempotencyKey);
  assert.throws(() => ledger.transition(first.record.idempotencyKey, EXECUTION_STATES.ACCEPTED), ReconciliationError);
  const reconciled = ledger.reconcile(first.record.idempotencyKey, { status: "filled", orderId: "order-1", dealIds: ["deal-1"] });
  assert.equal(reconciled.state, EXECUTION_STATES.FILLED);
  assert.equal(reconciled.brokerOrderId, "order-1");
});

test("Mirro transport keeps credentials server-side, normalizes trusted demo metadata, and fails closed", async () => {
  const requests = [];
  const transport = new MirroMt5Transport({ apiKey: "server-secret", accountId: "acc_demo", fetchImpl: async (url, options) => {
    requests.push({ url: String(url), options });
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ login: "12345", environment: "demo", server: "Broker-Demo", broker: "Broker", currency: "USD", equity: "10000" }) };
  } });
  const info = await transport.getAccountInfo();
  assert.equal(info.trade_mode, 0);
  assert.match(requests[0].options.headers.Authorization, /^Bearer /);
  assert.equal(JSON.stringify(info).includes("server-secret"), false);
  const missing = new MirroMt5Transport({ apiKey: "", accountId: "" });
  await assert.rejects(() => missing.getAccountInfo(), /provider request failed/i);
  const live = new MirroMt5Transport({ apiKey: "server-secret", accountId: "acc_live", fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ login: "12345", environment: "live", server: "Broker-Live", broker: "Broker", currency: "USD", equity: "10000" }) }) });
  assert.equal((await live.getAccountInfo()).trade_mode, 2);
});
