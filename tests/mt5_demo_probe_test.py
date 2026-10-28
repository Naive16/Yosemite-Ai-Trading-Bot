"""Synthetic SDK unit tests. No MetaTrader5 package or terminal is used."""

from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bridge import mt5_demo_probe as probe

NOW = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)
SECRET = "synthetic-password-never-output"


def environment(**overrides):
    return {"MT5_TERMINAL_PATH": r"C:\MT5 Demo\terminal64.exe", "MT5_LOGIN": "12345", "MT5_PASSWORD": SECRET, "MT5_SERVER": "Broker-Demo", "MT5_SYMBOL": "EURUSD", "MT5_ALLOWED_ACCOUNT_LOGINS": "12345", "MT5_ALLOWED_SERVERS": "Broker-Demo", **overrides}


class MockSdk:
    ACCOUNT_TRADE_MODE_DEMO = 0

    def __init__(self):
        self.calls = []
        self.account = SimpleNamespace(login=12345, server="Broker-Demo", trade_mode=0, equity=10000.0, balance=10000.0, margin_free=10000.0, margin=0.0, company="Broker", currency="USD", margin_mode=2, leverage=100, trade_allowed=True, trade_expert=False, password=SECRET, name="private-account-holder")
        self.terminal = SimpleNamespace(path=r"C:\MT5 Demo", connected=True, trade_allowed=False, tradeapi_disabled=True, build=5500, password=SECRET)
        self.symbol = SimpleNamespace(name="EURUSD", visible=True, point=0.00001, trade_contract_size=100000.0, volume_min=0.01, volume_max=100.0, volume_step=0.01, trade_tick_size=0.00001, trade_tick_value=1.0, trade_tick_value_profit=1.0, trade_tick_value_loss=1.0, digits=5, trade_mode=4, filling_mode=1, trade_exemode=2, trade_stops_level=0, trade_freeze_level=0, currency_base="EUR", currency_profit="USD", currency_margin="EUR")
        self.tick = SimpleNamespace(bid=1.1, ask=1.1001, time=int((NOW - timedelta(seconds=2)).timestamp()), time_msc=int((NOW - timedelta(seconds=2)).timestamp() * 1000))
        self.positions = ()
        self.orders = ()
        self.deals = ()
        self.initialize_result = True
        self.initialize_error = False
        self.shutdown_error = False
        self.end_account = None
        self.end_terminal = None

    def _record(self, name, *args, **kwargs):
        self.calls.append((name, args, kwargs))

    def initialize(self, *args, **kwargs):
        self._record("initialize", *args, **kwargs)
        if self.initialize_error:
            print(SECRET)
            raise RuntimeError(SECRET)
        return self.initialize_result

    def terminal_info(self):
        self._record("terminal_info")
        return self.end_terminal if self.end_terminal is not None and sum(name == "terminal_info" for name, _, _ in self.calls) > 1 else self.terminal

    def account_info(self):
        self._record("account_info")
        return self.end_account if self.end_account is not None and sum(name == "account_info" for name, _, _ in self.calls) > 1 else self.account

    def symbol_info(self, symbol):
        self._record("symbol_info", symbol)
        return self.symbol

    def symbol_info_tick(self, symbol):
        self._record("symbol_info_tick", symbol)
        return self.tick

    def positions_get(self):
        self._record("positions_get")
        return self.positions

    def orders_get(self):
        self._record("orders_get")
        return self.orders

    def history_deals_get(self, start, end):
        self._record("history_deals_get", start, end)
        return self.deals

    def shutdown(self):
        self._record("shutdown")
        if self.shutdown_error:
            raise RuntimeError(SECRET)

    def order_send(self, *args, **kwargs):
        raise AssertionError("Orders are forbidden in this test")

    def order_check(self, *args, **kwargs):
        raise AssertionError("Order requests are forbidden in this test")


class NativeProbeTests(unittest.TestCase):
    def config(self, **overrides):
        return probe.load_probe_config(environment(**overrides), is_file=lambda path: True)

    def collect(self, sdk):
        return probe.probe_native_demo(self.config(), sdk, now=lambda: NOW)

    def cli(self, arguments=(), sdk=None, **kwargs):
        output = io.StringIO()
        loader = (lambda: sdk) if sdk is not None else kwargs.pop("sdk_loader", None)
        code = probe.main(list(arguments), env=kwargs.pop("env", environment()), output=output, sdk_loader=loader, is_file=kwargs.pop("is_file", lambda path: True), now=lambda: NOW, platform_name=kwargs.pop("platform_name", "win32"), bits=kwargs.pop("bits", 64), **kwargs)
        self.assertNotIn(SECRET, output.getvalue())
        return code, json.loads(output.getvalue())

    def test_default_is_offline_without_sdk_import_or_connection(self):
        with patch.object(probe.importlib, "import_module", side_effect=AssertionError("SDK must not import")):
            code, report = self.cli()
        self.assertEqual(code, 2)
        self.assertTrue(report["configurationValid"])
        self.assertFalse(report["connectionAttempted"])
        self.assertFalse(report["executionAllowed"])
        self.assertFalse(report["nativeDemoAccountVerified"])

    def test_invalid_configuration_is_rejected_before_sdk_loading(self):
        for overrides in [{"MT5_ALLOWED_ACCOUNT_LOGINS": "999"}, {"MT5_ALLOWED_SERVERS": "broker-demo"}, {"MT5_TERMINAL_PATH": "terminal64.exe"}, {"MT5_TERMINAL_PATH": r"\\server\share\terminal64.exe"}, {"MT5_LOGIN": ""}, {"MT5_PASSWORD": ""}]:
            with self.subTest(overrides=tuple(overrides)):
                code, report = self.cli(("--connect-read-only",), env=environment(**overrides), sdk_loader=lambda: self.fail("No SDK load before validation"))
                self.assertEqual(code, 2)
                self.assertFalse(report["connectionAttempted"])
        code, report = self.cli(("--connect-read-only",), is_file=lambda path: False, sdk_loader=lambda: self.fail("No SDK load for missing EXE"))
        self.assertEqual(report["errorCode"], "configured_terminal_exe_unavailable")

    def test_mocked_probe_reads_native_fields_but_never_claims_external_verification(self):
        sdk = MockSdk()
        report = self.collect(sdk)
        self.assertTrue(report["readOnlyProbeSucceeded"])
        self.assertTrue(report["identityChecksPassed"])
        self.assertFalse(report["nativeDemoAccountVerified"])
        self.assertEqual(report["evidenceSource"], "injected-test")
        self.assertFalse(report["executionAllowed"])
        self.assertFalse(report["actualBrokerOrderExecuted"])
        self.assertEqual(report["releaseReadiness"], "blocked")
        self.assertEqual(report["account"]["login"], "12345")
        self.assertEqual(report["symbol"]["tickValueLoss"], 1.0)
        self.assertEqual(report["symbol"]["stopsLevelPoints"], 0)
        self.assertTrue(report["sdkShutdownConfirmed"])
        serialized = json.dumps(report)
        self.assertNotIn(SECRET, serialized)
        self.assertNotIn("private-account-holder", serialized)
        initialization = sdk.calls[0]
        self.assertEqual(initialization[1], (r"C:\MT5 Demo\terminal64.exe",))
        self.assertEqual(initialization[2]["login"], 12345)
        self.assertEqual(initialization[2]["server"], "Broker-Demo")
        self.assertEqual(initialization[2]["password"], SECRET)
        self.assertEqual({name for name, _, _ in sdk.calls}, {"initialize", "terminal_info", "account_info", "symbol_info", "symbol_info_tick", "positions_get", "orders_get", "history_deals_get", "shutdown"})

    def test_real_contest_unknown_or_mismatched_accounts_are_rejected_and_shutdown(self):
        for field, value in [("trade_mode", 2), ("trade_mode", 1), ("trade_mode", None), ("login", 999), ("server", "Other-Demo")]:
            sdk = MockSdk()
            setattr(sdk.account, field, value)
            report = self.collect(sdk)
            self.assertFalse(report["readOnlyProbeSucceeded"])
            self.assertFalse(report["nativeDemoAccountVerified"])
            self.assertTrue(report["sdkShutdownConfirmed"])
            self.assertNotIn("symbol_info", [call[0] for call in sdk.calls])

    def test_wrong_disconnected_or_algo_enabled_terminal_is_rejected_without_enabling_permissions(self):
        for field, value in [("connected", False), ("path", r"C:\Other MT5"), ("trade_allowed", True), ("trade_allowed", None)]:
            sdk = MockSdk()
            setattr(sdk.terminal, field, value)
            report = self.collect(sdk)
            self.assertFalse(report["readOnlyProbeSucceeded"])
            self.assertTrue(report["sdkShutdownConfirmed"])
        sdk = MockSdk()
        sdk.account.trade_allowed = False
        sdk.account.trade_expert = False
        self.assertTrue(self.collect(sdk)["readOnlyProbeSucceeded"], "Read-only identity must not require trading permission")

    def test_account_or_terminal_switch_during_collection_invalidates_the_snapshot(self):
        for changed in [SimpleNamespace(**{**vars(MockSdk().account), "login": 999}), SimpleNamespace(**{**vars(MockSdk().account), "trade_mode": 2}), SimpleNamespace(**{**vars(MockSdk().account), "server": "Other-Demo"})]:
            sdk = MockSdk()
            sdk.end_account = changed
            report = self.collect(sdk)
            self.assertFalse(report["nativeDemoAccountVerified"])
            self.assertFalse(report["readOnlyProbeSucceeded"])
            self.assertNotIn("account", report)
        sdk = MockSdk()
        sdk.end_terminal = SimpleNamespace(**{**vars(sdk.terminal), "connected": False})
        self.assertFalse(self.collect(sdk)["readOnlyProbeSucceeded"])

    def test_missing_contract_fields_are_not_replaced_with_defaults(self):
        sdk = MockSdk()
        sdk.symbol.trade_tick_value = None
        sdk.symbol.filling_mode = None
        sdk.symbol.point = float("nan")
        report = self.collect(sdk)
        self.assertIsNone(report["symbol"]["tickValue"])
        self.assertIsNone(report["symbol"]["point"])
        self.assertIn("symbol.tickValue", report["missingRiskInputs"])
        self.assertIn("symbol.fillingModeFlags", report["missingRiskInputs"])
        self.assertFalse(report["readOnlyProbeSucceeded"])
        json.dumps(report, allow_nan=False)

    def test_stale_invalid_future_and_missing_quotes_are_not_fabricated(self):
        for changed in [None, SimpleNamespace(bid=float("nan"), ask=1.2, time_msc=int(NOW.timestamp() * 1000)), SimpleNamespace(bid=1.2, ask=1.1, time_msc=int(NOW.timestamp() * 1000)), SimpleNamespace(bid=1.1, ask=1.2, time_msc=int((NOW - timedelta(seconds=60)).timestamp() * 1000)), SimpleNamespace(bid=1.1, ask=1.2, time_msc=int((NOW + timedelta(seconds=60)).timestamp() * 1000))]:
            sdk = MockSdk()
            sdk.tick = changed
            report = self.collect(sdk)
            self.assertIn("fresh_native_bid_ask_unavailable", report["missingRiskInputs"])
            self.assertFalse(report["readOnlyProbeSucceeded"])

    def test_unavailable_books_are_not_empty_and_history_scope_is_explicit(self):
        sdk = MockSdk()
        sdk.positions = sdk.orders = sdk.deals = None
        report = self.collect(sdk)
        for name in ("positions", "orders", "history"):
            self.assertIsNone(report[name]["count"])
            self.assertFalse(report[name]["available"])
        self.assertFalse(report["history"]["completeAccountHistory"])
        self.assertFalse(report["history"]["authoritativeDailyRisk"])
        self.assertEqual(report["history"]["scope"], "last_24_hours_only")
        start, end = next(call[1] for call in sdk.calls if call[0] == "history_deals_get")
        self.assertEqual(end - start, timedelta(days=1))
        self.assertEqual(start.tzinfo, timezone.utc)

    def test_a_slow_collection_rechecks_quote_freshness_at_final_capture(self):
        sdk = MockSdk()
        samples = iter((NOW, NOW + timedelta(seconds=60)))
        report = probe.probe_native_demo(self.config(), sdk, now=lambda: next(samples))
        self.assertFalse(report["readOnlyProbeSucceeded"])
        self.assertIn("fresh_native_bid_ask_unavailable", report["missingRiskInputs"])
        self.assertEqual(report["quote"]["ageSeconds"], 62)
        self.assertEqual(report["capturedAt"], (NOW + timedelta(seconds=60)).isoformat())
        self.assertEqual(report["history"]["to"], NOW.isoformat(), "History must retain its actual query window")

    def test_rows_are_bounded_and_broker_ticket_identifiers_remain_exact_strings(self):
        sdk = MockSdk()
        ticket = 9007199254740993
        sdk.positions = tuple(SimpleNamespace(ticket=ticket, identifier=ticket, symbol="EURUSD", type=0, volume=0.01) for _ in range(probe.MAX_ROWS + 1))
        report = self.collect(sdk)
        self.assertEqual(report["positions"]["items"][0]["ticket"], str(ticket))
        self.assertEqual(len(report["positions"]["items"]), probe.MAX_ROWS)
        self.assertFalse(report["positions"]["complete"])
        self.assertFalse(report["readOnlyProbeSucceeded"])

    def test_sdk_failures_are_redacted_and_shutdown_is_attempted_after_initialization_failure(self):
        for raised in (False, True):
            sdk = MockSdk()
            sdk.initialize_result = False
            sdk.initialize_error = raised
            output = io.StringIO()
            with redirect_stdout(output), redirect_stderr(output):
                report = self.collect(sdk)
            self.assertNotIn(SECRET, output.getvalue())
            self.assertNotIn(SECRET, json.dumps(report))
            self.assertEqual(sdk.calls[-1][0], "shutdown")
        sdk = MockSdk()
        sdk.shutdown_error = True
        report = self.collect(sdk)
        self.assertFalse(report["sdkShutdownConfirmed"])
        self.assertFalse(report["readOnlyProbeSucceeded"])

    def test_cli_explicit_mock_connection_is_labeled_and_unsupported_arguments_do_not_echo_values(self):
        code, report = self.cli(("--connect-read-only",), sdk=MockSdk())
        self.assertEqual(code, 0)
        self.assertTrue(report["connectionAttempted"])
        self.assertEqual(report["evidenceSource"], "mock-sdk")
        self.assertFalse(report["nativeDemoAccountVerified"])
        code, report = self.cli(("--password", SECRET))
        self.assertEqual(code, 2)
        self.assertEqual(report["errorCode"], "unsupported_probe_arguments")

    def test_unsupported_runtime_and_missing_package_are_safe_without_connection(self):
        for kwargs in [{"platform_name": "linux"}, {"bits": 32}]:
            code, report = self.cli(("--connect-read-only",), sdk_loader=lambda: self.fail("No SDK load on unsupported runtime"), **kwargs)
            self.assertEqual(code, 2)
            self.assertFalse(report["connectionAttempted"])
        def missing():
            raise ImportError(SECRET)
        code, report = self.cli(("--connect-read-only",), sdk_loader=missing)
        self.assertEqual(code, 2)
        self.assertEqual(report["errorCode"], "official_metatrader5_package_unavailable")


if __name__ == "__main__":
    unittest.main()
