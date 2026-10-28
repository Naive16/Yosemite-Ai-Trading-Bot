import test from "node:test";
import assert from "node:assert/strict";
import { inspectDemoPreflight } from "../api/_lib/mt5/demo-preflight.js";

const environment = { APP_ENV: "test", SUPABASE_URL: "https://txdjozotaxpthpnfikqx.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_preflight_fixture", MIRRO_API_KEY: "fixture-secret-never-returned", MIRRO_ACCOUNT_ID: "fixture-account-never-returned", MT5_ALLOWED_ACCOUNT_LOGINS: "12345", MT5_ALLOWED_SERVERS: "Broker-Demo" };

test("demo preflight distinguishes present settings from external verification and never grants execution", () => {
  const result = inspectDemoPreflight(environment);
  assert.equal(result.status, "blocked");
  assert.equal(result.configuration.valid, true);
  assert.equal(result.configuration.supabasePublicSettingsPresent, true);
  assert.equal(result.configuration.mirroCredentialFieldsPresent, true);
  assert.equal(result.actualBrokerDemoExecutionVerified, false);
  assert.equal(result.executionAllowed, false);
  assert.ok(Object.values(result.externalVerification).every((state) => state === "not_performed_by_this_check"));
  for (const value of [environment.SUPABASE_PUBLISHABLE_KEY, environment.MIRRO_API_KEY, environment.MIRRO_ACCOUNT_ID, environment.MT5_ALLOWED_ACCOUNT_LOGINS, environment.MT5_ALLOWED_SERVERS]) assert.equal(JSON.stringify(result).includes(value), false);
  assert.deepEqual(result.controls, { tradingMode: "disabled", liveTradingEnabled: false, workerEnabled: false, mt5DemoMode: false, mt5ExecutionEnabled: false, mt5Connector: "none" });
});

test("missing settings and invalid production configuration remain explicit blockers", () => {
  const missing = inspectDemoPreflight({ APP_ENV: "test" });
  assert.equal(missing.configuration.supabasePublicSettingsPresent, false);
  assert.ok(missing.blockers.includes("supabase_public_configuration_missing"));
  assert.ok(missing.blockers.includes("exact_broker_account_and_server_allowlists_missing"));
  const invalid = inspectDemoPreflight({ APP_ENV: "production" });
  assert.equal(invalid.configuration.valid, false);
  assert.equal(invalid.controls, null);
  assert.equal(invalid.executionAllowed, false);
});

test("the selected native route remains blocked even when every probe field is present", () => {
  const result = inspectDemoPreflight({ ...environment, MT5_TERMINAL_PATH: "C:\\Synthetic\\terminal64.exe", MT5_LOGIN: "12345", MT5_PASSWORD: "native-fixture-secret", MT5_SERVER: "Broker-Demo", MT5_SYMBOL: "EURUSD" });
  assert.equal(result.selectedBridgeRoute, "windows_vps_mt5_terminal");
  assert.equal(result.configuration.nativeProbeFieldsPresentInThisProcess, true);
  assert.equal(result.executionAllowed, false);
  assert.equal(result.actualBrokerDemoExecutionVerified, false);
  assert.equal(JSON.stringify(result).includes("native-fixture-secret"), false);
  assert.equal(JSON.stringify(result).includes("Synthetic"), false);
  assert.equal(result.externalVerification.terminalInstallation, "not_performed_by_this_check");
});

test("execution switches and secret Supabase keys cannot turn an offline report into approval", () => {
  for (const override of [{ LIVE_TRADING_ENABLED: "true" }, { WORKER_ENABLED: "true" }, { MT5_DEMO_MODE: "true" }, { MT5_EXECUTION_ENABLED: "true" }, { MT5_CONNECTOR: "mirro" }, { TRADING_MODE: "demo" }, { SUPABASE_PUBLISHABLE_KEY: "sb_secret_forbidden" }]) {
    const result = inspectDemoPreflight({ ...environment, ...override });
    assert.equal(result.configuration.valid, false);
    assert.equal(result.executionAllowed, false);
    assert.equal(result.actualBrokerDemoExecutionVerified, false);
    assert.equal(JSON.stringify(result).includes("sb_secret_forbidden"), false);
  }
});
