"""Synthetic running-terminal inspection tests; never import or call MT5."""

from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bridge import mt5_demo_probe as probe


NOW = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)
TERMINAL = r"C:\Program Files\MetaTrader 5\terminal64.exe"
SECRET = "synthetic-secret-must-never-appear"
SYMBOL_CHECKS = ("symbolAvailable", "symbolVisible", "quoteValid", "quoteFresh", "tickSize", "tickValue", "spreadObserved")


class InspectionSdk:
    ACCOUNT_TRADE_MODE_DEMO = 0
    SYMBOL_CALC_MODE_FOREX = 0
    SYMBOL_CALC_MODE_FOREX_NO_LEVERAGE = 5

    def __init__(self):
        self.calls = []
        self.terminal = SimpleNamespace(path=r"C:\Program Files\MetaTrader 5", connected=True, trade_allowed=False, tradeapi_disabled=True, build=6230, password=SECRET)
        self.account = SimpleNamespace(login=12345, server="Synthetic-Demo", trade_mode=0, currency="USD", balance=10000.0, equity=10000.0, margin_free=10000.0, margin=0.0, trade_allowed=True, trade_expert=False, company="Synthetic", margin_mode=2, leverage=100, name="private-account-holder", password=SECRET)
        self.symbol = SimpleNamespace(name="EURUSD", visible=True, point=0.00001, trade_contract_size=100000.0, volume_min=0.01, volume_max=100.0, volume_step=0.01, trade_tick_size=0.00001, trade_tick_value=1.0, trade_tick_value_profit=1.0, trade_tick_value_loss=1.0, digits=5, trade_mode=4, filling_mode=1, trade_exemode=2, trade_calc_mode=0, trade_stops_level=0, trade_freeze_level=0, currency_base="EUR", currency_profit="USD", currency_margin="EUR")
        self.tick = SimpleNamespace(bid=1.1000, ask=1.1001, time=int((NOW - timedelta(seconds=2)).timestamp()), time_msc=int((NOW - timedelta(seconds=2)).timestamp() * 1000))
        self.final_terminal = None
        self.final_account = None
        self.initialize_result = True
        self.initialize_error = False
        self.shutdown_error = False
        self.market_watch = ()

    def initialize(self, *args, **kwargs):
        self.calls.append(("initialize", args, kwargs))
        if self.initialize_error:
            print(SECRET)
            raise RuntimeError(SECRET)
        return self.initialize_result

    def terminal_info(self):
        self.calls.append(("terminal_info", (), {}))
        if self.final_terminal is not None and sum(name == "terminal_info" for name, _, _ in self.calls) > 1:
            return self.final_terminal
        return self.terminal

    def account_info(self):
        self.calls.append(("account_info", (), {}))
        if self.final_account is not None and sum(name == "account_info" for name, _, _ in self.calls) > 1:
            return self.final_account
        return self.account

    def symbol_info(self, symbol):
        self.calls.append(("symbol_info", (symbol,), {}))
        return self.symbol

    def symbol_info_tick(self, symbol):
        self.calls.append(("symbol_info_tick", (symbol,), {}))
        return self.tick

    def symbols_get(self):
        self.calls.append(("symbols_get", (), {}))
        return self.market_watch

    def shutdown(self):
        self.calls.append(("shutdown", (), {}))
        if self.shutdown_error:
            raise RuntimeError(SECRET)

    def __getattr__(self, name):
        if name in {"order_send", "order_check", "login", "symbol_select", "positions_get", "orders_get", "history_deals_get"}:
            raise AssertionError("Unexpected SDK capability: " + name)
        raise AttributeError(name)


class PasswordGuardEnvironment(dict):
    """Even reading the existing password setting is forbidden in discovery."""

    def get(self, key, *args):
        if key == "MT5_PASSWORD":
            raise AssertionError("Discovery must not read a password")
        return super().get(key, *args)

    def __getitem__(self, key):
        if key == "MT5_PASSWORD":
            raise AssertionError("Discovery must not read a password")
        return super().__getitem__(key)


class RunningInspectionTests(unittest.TestCase):
    def inspect(self, sdk=None, symbol="EURUSD", checker=None, **kwargs):
        return probe.inspect_running_demo(TERMINAL, symbol, sdk or InspectionSdk(), now=lambda: NOW, running_terminal_checker=checker or (lambda path: path == TERMINAL), **kwargs)

    def cli(self, arguments, sdk=None, env=None, is_file=None, checker=None, loader=None):
        output = io.StringIO()
        code = probe.main(arguments, env={} if env is None else env, output=output, sdk_loader=loader or (lambda: sdk or InspectionSdk()), is_file=is_file or (lambda path: path == TERMINAL), now=lambda: NOW, platform_name="win32", bits=64, running_terminal_checker=checker or (lambda path: path == TERMINAL))
        serialized = output.getvalue()
        self.assertNotIn(SECRET, serialized)
        self.assertNotIn("private-account-holder", serialized)
        return code, json.loads(serialized)

    def assert_no_execution(self, report):
        self.assertFalse(report["executionAllowed"])
        self.assertFalse(report["actualBrokerOrderExecuted"])
        self.assertEqual(report["releaseReadiness"], "blocked")

    def test_success_uses_only_whitelisted_reads_and_no_credentials(self):
        sdk = InspectionSdk()
        report = self.inspect(sdk)
        self.assertTrue(report["readOnlyProbeSucceeded"])
        self.assertTrue(all(value == "PASS" for value in report["checks"].values()))
        self.assertFalse(report["nativeDemoAccountVerified"])
        self.assertEqual(sdk.calls[0], ("initialize", (TERMINAL,), {"timeout": 10000, "portable": False}))
        self.assertEqual(sdk.calls[-1][0], "shutdown")
        self.assertLessEqual({name for name, _, _ in sdk.calls}, {"initialize", "terminal_info", "account_info", "symbols_get", "symbol_info", "symbol_info_tick", "shutdown"})
        self.assertEqual(report["account"]["login"], "12345")
        self.assertEqual(report["account"]["server"], "Synthetic-Demo")
        self.assertEqual(report["account"]["currency"], "USD")
        self.assertEqual(report["account"]["balance"], 10000.0)
        self.assertEqual(report["account"]["equity"], 10000.0)
        self.assertEqual(report["account"]["freeMargin"], 10000.0)
        self.assertTrue(report["account"]["tradeAllowed"])
        self.assertFalse(report["account"]["expertTradingAllowed"])
        self.assertNotIn(SECRET, json.dumps(report))
        self.assertNotIn("private-account-holder", json.dumps(report))
        self.assert_no_execution(report)

    def test_native_evidence_still_never_authorizes_an_order(self):
        # This injected fixture tests the label gate; it is not broker evidence.
        report = self.inspect(evidence_source="native-sdk")
        self.assertTrue(report["nativeDemoAccountVerified"])
        self.assert_no_execution(report)

    def test_running_process_and_existing_file_gate_before_sdk_loading(self):
        sdk = InspectionSdk()
        report = self.inspect(sdk, checker=lambda path: False)
        self.assertEqual(report["checks"]["runningTerminal"], "FAIL")
        self.assertFalse(report["readOnlyProbeSucceeded"])
        self.assertNotIn("initialize", [name for name, _, _ in sdk.calls])
        for overrides in ({"checker": lambda path: False}, {"is_file": lambda path: False}):
            with self.subTest(overrides=tuple(overrides)):
                def forbidden_loader():
                    self.fail("SDK must not load before installation/running-process validation")
                code, result = self.cli(["--inspect-running-read-only", "--terminal-path", TERMINAL, "--symbol", "EURUSD"], loader=forbidden_loader, **overrides)
                self.assertEqual(code, 2)
                self.assertFalse(result["connectionAttempted"])

    def test_cli_discovery_ignores_password_and_does_not_infer_a_symbol(self):
        sdk = InspectionSdk()
        env = PasswordGuardEnvironment({"MT5_PASSWORD": SECRET, "MT5_SYMBOL": "UNAPPROVED-FALLBACK"})
        code, report = self.cli(["--inspect-running-read-only", "--terminal-path", TERMINAL], sdk=sdk, env=env)
        self.assertEqual(code, 2)
        self.assertEqual(report["checks"]["accountIdentity"], "PASS")
        self.assertEqual(report["checks"]["symbolSpecified"], "FAIL")
        for check in SYMBOL_CHECKS:
            self.assertEqual(report["checks"][check], "NOT_RUN")
        self.assertNotIn("symbol_info", [name for name, _, _ in sdk.calls])
        self.assertFalse(report["nativeDemoAccountVerified"])
        self.assert_no_execution(report)

    def test_terminal_path_connection_and_both_trading_controls_are_strict(self):
        for attribute, value, failed_check in (("path", r"C:\Other", "terminalPath"), ("connected", False, "terminalConnected"), ("connected", None, "terminalConnected"), ("trade_allowed", True, "algoTradingDisabled"), ("trade_allowed", None, "algoTradingDisabled"), ("tradeapi_disabled", False, "externalPythonTradingDisabled"), ("tradeapi_disabled", None, "externalPythonTradingDisabled")):
            with self.subTest(attribute=attribute, value=value):
                sdk = InspectionSdk()
                setattr(sdk.terminal, attribute, value)
                report = self.inspect(sdk)
                self.assertEqual(report["checks"][failed_check], "FAIL")
                self.assertFalse(report["readOnlyProbeSucceeded"])
                self.assertFalse(report["nativeDemoAccountVerified"])
                self.assertNotIn("symbol_info", [name for name, _, _ in sdk.calls])

    def test_demo_classification_uses_native_integer_not_names_or_flags(self):
        for trade_mode in (1, 2, 99, None, "0", False):
            with self.subTest(trade_mode=trade_mode):
                sdk = InspectionSdk()
                sdk.account.trade_mode = trade_mode
                sdk.account.name = "Definitely a DEMO account"
                sdk.account.demo = True
                report = self.inspect(sdk)
                self.assertEqual(report["checks"]["demoClassification"], "FAIL")
                self.assertFalse(report["nativeDemoAccountVerified"])
                self.assertNotIn("symbol_info", [name for name, _, _ in sdk.calls])
        sdk = InspectionSdk()
        sdk.ACCOUNT_TRADE_MODE_DEMO = 7
        self.assertEqual(self.inspect(sdk)["checks"]["demoClassification"], "FAIL")

    def test_unavailable_or_invalid_account_fields_never_become_defaults(self):
        sdk = InspectionSdk()
        sdk.account = None
        self.assertEqual(self.inspect(sdk)["checks"]["accountAvailable"], "FAIL")
        for attribute, value in (("login", 0), ("login", "12345"), ("server", ""), ("server", None)):
            with self.subTest(attribute=attribute, value=value):
                sdk = InspectionSdk()
                setattr(sdk.account, attribute, value)
                report = self.inspect(sdk)
                self.assertEqual(report["checks"]["accountIdentity"], "FAIL")
                self.assertFalse(report["nativeDemoAccountVerified"])
        for attribute, value in (("currency", None), ("balance", float("nan")), ("equity", float("inf")), ("margin_free", None), ("trade_allowed", None), ("trade_expert", None)):
            with self.subTest(attribute=attribute, value=value):
                sdk = InspectionSdk()
                setattr(sdk.account, attribute, value)
                report = self.inspect(sdk)
                self.assertEqual(report["checks"]["accountFields"], "FAIL")
                self.assertFalse(report["readOnlyProbeSucceeded"])
                json.dumps(report, allow_nan=False)

    def test_final_account_terminal_and_process_changes_invalidate_snapshot(self):
        for change in ("account", "terminal", "external_permission", "process"):
            with self.subTest(change=change):
                sdk = InspectionSdk()
                checker = None
                if change == "account":
                    sdk.final_account = SimpleNamespace(**{**vars(sdk.account), "login": 54321})
                elif change == "terminal":
                    sdk.final_terminal = SimpleNamespace(**{**vars(sdk.terminal), "path": r"C:\Other"})
                elif change == "external_permission":
                    sdk.final_terminal = SimpleNamespace(**{**vars(sdk.terminal), "tradeapi_disabled": False})
                else:
                    states = iter((True, False))
                    checker = lambda path: next(states)
                report = self.inspect(sdk, checker=checker)
                self.assertEqual(report["checks"]["terminalAndAccountStable"], "FAIL")
                self.assertFalse(report["readOnlyProbeSucceeded"])
                self.assertFalse(report["nativeDemoAccountVerified"])

    def test_missing_or_hidden_symbol_is_reported_without_selecting_it(self):
        sdk = InspectionSdk()
        sdk.symbol = None
        report = self.inspect(sdk)
        self.assertEqual(report["checks"]["symbolAvailable"], "FAIL")
        self.assertFalse(report["readOnlyProbeSucceeded"])
        sdk = InspectionSdk()
        sdk.symbol.visible = False
        report = self.inspect(sdk)
        self.assertEqual(report["checks"]["symbolVisible"], "FAIL")
        self.assertFalse(report["readOnlyProbeSucceeded"])

    def test_bad_quote_staleness_and_missing_tick_inputs_fail_explicitly(self):
        for attribute, value, failed_check in (("bid", 0, "quoteValid"), ("ask", 1.0, "quoteValid"), ("time_msc", int((NOW - timedelta(minutes=1)).timestamp() * 1000), "quoteFresh"), ("time_msc", int((NOW + timedelta(minutes=1)).timestamp() * 1000), "quoteFresh")):
            with self.subTest(attribute=attribute, value=value):
                sdk = InspectionSdk()
                setattr(sdk.tick, attribute, value)
                report = self.inspect(sdk)
                self.assertEqual(report["checks"][failed_check], "FAIL")
                self.assertFalse(report["readOnlyProbeSucceeded"])
        for attribute, value, failed_check in (("trade_tick_size", 0, "tickSize"), ("trade_tick_value", None, "tickValue"), ("trade_tick_value", float("inf"), "tickValue")):
            with self.subTest(attribute=attribute, value=value):
                sdk = InspectionSdk()
                setattr(sdk.symbol, attribute, value)
                report = self.inspect(sdk)
                self.assertEqual(report["checks"][failed_check], "FAIL")
                self.assertFalse(report["readOnlyProbeSucceeded"])
                json.dumps(report, allow_nan=False)

    def test_initialization_and_shutdown_failures_are_redacted(self):
        for raised in (False, True):
            sdk = InspectionSdk()
            sdk.initialize_result = False
            sdk.initialize_error = raised
            output = io.StringIO()
            with redirect_stdout(output), redirect_stderr(output):
                report = self.inspect(sdk)
            self.assertEqual(report["checks"]["sdkInitialized"], "FAIL")
            self.assertNotIn(SECRET, output.getvalue())
            self.assertNotIn(SECRET, json.dumps(report))
            self.assertFalse(report["readOnlyProbeSucceeded"])
        sdk = InspectionSdk()
        sdk.shutdown_error = True
        report = self.inspect(sdk)
        self.assertEqual(report["checks"]["sdkShutdown"], "FAIL")
        self.assertFalse(report["readOnlyProbeSucceeded"])
        self.assertNotIn(SECRET, json.dumps(report))

    def test_market_watch_and_candidates_use_native_modes_and_currency_metadata(self):
        sdk = InspectionSdk()
        def row(name, mode=0, visible=True, base="EUR", profit="USD"):
            return SimpleNamespace(name=name, trade_calc_mode=mode, visible=visible, currency_base=base, currency_profit=profit, password=SECRET)
        sdk.market_watch = (row("EURUSD"), row("EURUSD.m", mode=5), row("EURUSD-hidden", visible=False), row("USDJPY", base="USD", profit="JPY"), row("EURUSD-CFD", mode=1), row("EURUSD-bool-mode", mode=False), row("EURUSD-name-only", base="USD", profit="JPY"))
        report = self.inspect(sdk)
        self.assertEqual(report["checks"]["marketWatchSymbols"], "PASS")
        self.assertTrue(report["symbolDiscoveryComplete"])
        self.assertEqual([item["symbol"] for item in report["marketWatchForexSymbols"]], ["EURUSD", "EURUSD-name-only", "EURUSD.m", "USDJPY"])
        self.assertEqual([item["symbol"] for item in report["eurUsdCandidates"]], ["EURUSD", "EURUSD-hidden", "EURUSD.m"])
        hidden = next(item for item in report["eurUsdCandidates"] if item["symbol"] == "EURUSD-hidden")
        self.assertFalse(hidden["visible"])
        self.assertNotIn(SECRET, json.dumps(report))

    def test_unavailable_catalogue_or_unverified_forex_constants_fail_discovery(self):
        sdk = InspectionSdk()
        sdk.market_watch = None
        report = self.inspect(sdk)
        self.assertEqual(report["checks"]["marketWatchSymbols"], "FAIL")
        self.assertFalse(report["symbolDiscoveryComplete"])
        self.assertFalse(report["readOnlyProbeSucceeded"])
        for first, second in ((None, 5), (0, None), (False, 5), (5, 0), (1, 5)):
            with self.subTest(forex=first, no_leverage=second):
                sdk = InspectionSdk()
                sdk.SYMBOL_CALC_MODE_FOREX = first
                sdk.SYMBOL_CALC_MODE_FOREX_NO_LEVERAGE = second
                report = self.inspect(sdk)
                self.assertFalse(report["symbolDiscoveryComplete"])
                self.assertFalse(report["readOnlyProbeSucceeded"])

    def test_derived_spread_points_never_escape_as_nonfinite_json(self):
        sdk = InspectionSdk()
        sdk.tick.bid = 1.0
        sdk.tick.ask = 1e308
        sdk.symbol.point = 1e-308
        report = self.inspect(sdk)
        json.dumps(report, allow_nan=False)


if __name__ == "__main__":
    unittest.main()
