import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, ConfigurationError } from "../api/_lib/config.js";
import { Mt5Adapter, Mt5ExecutionBlockedError, Mt5ValidationError, assertAllowedDemoAccount, classifyMt5Account, normalizeMt5Quote, normalizeMt5Symbol } from "../api/_lib/mt5/adapter.js";
import { EXECUTION_STATES, ExecutionLedger, ReconciliationError } from "../api/_lib/mt5/reconciliation.js";
import { MirroMt5Transport } from "../api/_lib/mt5/mirro.js";

const baseEnv = { APP_ENV: "test", APP_ORIGIN: "http://localhost:3000", SUPABASE_URL: "https://txdjozotaxpthpnfikqx.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only" };
const demoConfig = { demoMode: true, executionEnabled: false, allowedAccountLogins: ["12345"], allowedServers: ["Broker-Demo"] };
const account = { login: 12345, trade_mode: 0, server: "Broker-Demo", company: "Broker", currency: "USD", equity: 10_000, capturedAt: "2026-10-22T00:00:00Z" };

test("MT5 configuration allows demo mode independently while blocking live execution and connectors", () => {
  assert.equal(loadConfig(baseEnv).mt5.executionEnabled, false);
  assert.equal(loadConfig(baseEnv).mt5.demoMode, false);
  // Demo mode is allowed independently when allowlists are present
  assert.equal(loadConfig({ ...baseEnv, MT5_DEMO_MODE: "true", MT5_ALLOWED_ACCOUNT_LOGINS: "12345", MT5_ALLOWED_SERVERS: "Broker-Demo" }).mt5.demoMode, true);
  // Demo mode without allowlists is rejected
  assert.throws(() => loadConfig({ ...baseEnv, MT5_DEMO_MODE: "true" }), ConfigurationError);
  // Live execution remains hard-blocked
  assert.throws(() => loadConfig({ ...baseEnv, MT5_EXECUTION_ENABLED: "true" }), ConfigurationError);
  // Connectors remain blocked
  assert.throws(() => loadConfig({ ...baseEnv, MT5_CONNECTOR: "mirro" }), ConfigurationError);
  // Trading mode and live trading remain disabled
  assert.throws(() => loadConfig({ ...baseEnv, TRADING_MODE: "demo" }), ConfigurationError);
  assert.throws(() => loadConfig({ ...baseEnv, LIVE_TRADING_ENABLED: "true" }), ConfigurationError);
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

test("MT5 adapter isolates transport and allows demo order submission while blocking live execution", async () => {
  const adapter = new Mt5Adapter({ config: demoConfig, transport: { getAccountInfo: async () => account, getSymbolInfo: async () => ({ symbol: "EURUSD", visible: true, tradeMode: "full", contractSize: 100_000, volumeMin: 0.01, volumeMax: 5, volumeStep: 0.01, point: 0.00001, tickSize: 0.00001, tickValue: 1, fillingModes: ["return"] }), getQuote: async () => ({ symbol: "EURUSD", bid: 1.1, ask: 1.1002, timestamp: "2026-10-22T00:00:00Z" }) }, now: () => new Date("2026-10-22T00:00:30Z") });
  const connected = await adapter.connect();
  assert.equal(connected.demo, true);
  assert.equal(connected.executionAllowed, false);
  // In demo mode, missing required fields produce validation errors, not execution-blocked errors
  await assert.rejects(() => adapter.submitOrder({}), (error) => error instanceof Mt5ValidationError);
  // Valid demo order is accepted (simulated, not submitted to broker)
  const order = await adapter.submitOrder({ symbol: "EURUSD", volume: 0.01, type: "BUY", stopLoss: 1.09, takeProfit: 1.12, comment: "demo test" });
  assert.equal(order.simulated, true);
  assert.equal(order.submittedToBroker, false);
  assert.equal(order.demo, true);
  assert.equal(order.status, "accepted_demo");
  assert.equal(order.accountLogin, 12345);
  // Live (non-demo) mode still blocks submission
  const liveAdapter = new Mt5Adapter({ config: { demoMode: false, executionEnabled: false, allowedAccountLogins: [], allowedServers: [] }, transport: { getAccountInfo: async () => ({ ...account, trade_mode: 2, server: "Broker-Live" }) } });
  await assert.rejects(() => liveAdapter.submitOrder({ symbol: "EURUSD", volume: 0.01, type: "BUY" }), Mt5ExecutionBlockedError);
  await adapter.shutdown();
});

test("execution ledger is disabled by default, idempotent, and requires reconciliation after unknown outcomes", () => {
  const blocked = new ExecutionLedger({ idFactory: () => "exec_test_1234567890" });
  assert.throws(() => blocked.reserve({ proposalId: "prop_11111111-1111-4111-8111-111111111111", proposalVersion: 1, contentDigest: "a".repeat(64), gates: {} }), /disabled/);
  const ledger = new ExecutionLedger({ executionEnabled: true, idFactory: () => "exec_test_1234567890" });
  const gates = Object.fromEntries(["actor", "proposal", "digest", "risk", "inputs", "demo", "mode", "stop", "reserved", "finalRisk"].map((key) => [key, true]));
  const first = ledger.reserve({ proposalId: "prop_11111111-1111-4111-8111-111111111111", proposalVersion: 1, contentDigest: "a".repeat(64), gates });
  assert.equal(first.status, "reserved");
  assert.equal(ledger.reserve({ proposalId: "prop_11111111-1111-4111-8111-111111111111", proposalVersion: 1, contentDigest: "a".repeat(64), gates }).status, "duplicate");
  ledger.transition(first.record.idempotencyKey, EXECUTION_STATES.SUBMISSION_INITIATED);
  ledger.markSubmissionUnknown(first.record.idempotencyKey);
  assert.throws(() => ledger.transition(first.record.idempotencyKey, EXECUTION_STATES.ACCEPTED), ReconciliationError);
  const reconciled = ledger.reconcile(first.record.idempotencyKey, { status: "filled", orderId: "order-1", dealIds: ["deal-1"] });
  assert.equal(reconciled.state, EXECUTION_STATES.FILLED);
  assert.equal(reconciled.brokerOrderId, "order-1");
});

test("Mirro read-only metadata keeps credentials server-side and never claims verified demo classification", async () => {
  const requests = [];
  const transport = new MirroMt5Transport({ apiKey: "server-secret", accountId: "acc_demo", fetchImpl: async (url, options) => {
    requests.push({ url: String(url), options });
    const data = url.pathname.endsWith("/information")
      ? { server: "Broker-Demo", broker: "Broker", currency: "USD", balance: "10000", equity: "10000", margin: "0", freeMargin: "10000", updatedAt: null }
      : { id: "acc_demo", platform: "mt5", login: "12345", environment: "demo", server: "Broker-Demo", state: "DEPLOYED", connection: "CONNECTED" };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => data };
  } });
  const info = await transport.getAccountSnapshot();
  assert.equal(info.declaredEnvironment, "demo");
  assert.equal(info.verification, "unverified");
  assert.equal(info.executionAllowed, false);
  await assert.rejects(() => transport.getAccountInfo(), (error) => error.code === "account_classification_unverified");
  assert.match(requests[0].options.headers.Authorization, /^Bearer /);
  assert.equal(JSON.stringify(info).includes("server-secret"), false);
  const missing = new MirroMt5Transport({ apiKey: "", accountId: "" });
  await assert.rejects(() => missing.getAccountInfo(), /provider request failed/i);
});
