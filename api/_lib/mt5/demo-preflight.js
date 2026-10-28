import { loadConfig, ConfigurationError } from "../config.js";

// This is an offline inventory of the current release, never permission to
// connect to a terminal or submit an order. It accepts no claimed broker proof.
export function inspectDemoPreflight(env = {}) {
  const nativeFields = ["MT5_TERMINAL_PATH", "MT5_LOGIN", "MT5_PASSWORD", "MT5_SERVER", "MT5_SYMBOL", "MT5_ALLOWED_ACCOUNT_LOGINS", "MT5_ALLOWED_SERVERS"];
  const nativeProbeFieldsPresent = nativeFields.every((key) => typeof env[key] === "string" && Boolean(env[key].trim()));
  let config;
  const configurationErrors = [];
  try { config = loadConfig(env); }
  catch (error) {
    if (!(error instanceof ConfigurationError)) throw error;
    // ConfigurationError messages contain field names and fixed validation text.
    configurationErrors.push(error.message);
  }
  const blockers = [
    "supabase_live_auth_schema_rls_and_operator_not_verified",
    "broker_reported_demo_identity_not_verified",
    "broker_symbols_quotes_margin_and_risk_inputs_not_verified",
    "broker_adapter_not_connected_to_application",
    "trusted_proposal_and_risk_pipeline_not_implemented",
    "durable_execution_reservation_and_transition_repository_not_implemented",
    "order_submission_is_disabled",
    "restart_timeout_and_broker_reconciliation_not_verified",
    "release_and_specific_first_order_approvals_pending"
  ];
  if (!config) blockers.unshift("configuration_invalid");
  else {
    if (!config.supabase.configured) blockers.unshift("supabase_public_configuration_missing");
    if (!config.mt5.allowedAccountLogins.length || !config.mt5.allowedServers.length) blockers.push("exact_broker_account_and_server_allowlists_missing");
  }
  if (!nativeProbeFieldsPresent) blockers.push("native_probe_fields_missing_from_this_process_remote_host_not_inspected");
  return {
    status: "blocked",
    selectedBridgeRoute: "windows_vps_mt5_terminal",
    scope: "offline_local_configuration_and_implementation_inventory",
    executionAllowed: false,
    actualBrokerDemoExecutionVerified: false,
    configuration: {
      valid: Boolean(config),
      errors: configurationErrors,
      supabasePublicSettingsPresent: Boolean(config?.supabase.configured),
      mirroCredentialFieldsPresent: Boolean(config?.mt5.mirro.apiKey && config?.mt5.mirro.accountId),
      nativeProbeFieldsPresentInThisProcess: nativeProbeFieldsPresent,
      accountAllowlistPresent: Boolean(config?.mt5.allowedAccountLogins.length),
      serverAllowlistPresent: Boolean(config?.mt5.allowedServers.length)
    },
    controls: config ? {
      tradingMode: config.tradingMode, liveTradingEnabled: config.liveTradingEnabled,
      workerEnabled: config.worker.enabled, mt5DemoMode: config.mt5.demoMode,
      mt5ExecutionEnabled: config.mt5.executionEnabled, mt5Connector: config.mt5.connector
    } : null,
    externalVerification: Object.fromEntries(["supabaseAuth", "schemaAndRls", "authorizedOperator", "terminalInstallation", "bridgeContract", "brokerDemoIdentity", "brokerConnection", "brokerOrderAndDealHistory"].map((name) => [name, "not_performed_by_this_check"])),
    blockers,
    nextStep: "Follow docs/runbooks/mt5-demo-release.md. Configuration presence, mocks and builds do not prove an actual broker connection or fill."
  };
}
